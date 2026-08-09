#!/usr/bin/env bun

import { readFile } from "node:fs/promises"
import { arch, hostname, platform } from "node:os"
import { basename } from "node:path"
import { spawn } from "node:child_process"

import {
  cliDeviceCodeResponseSchema,
  cliDeviceTokenResponseSchema,
  cliServerReferenceSchema,
  cliServersResponseSchema,
  cliSftpResponseSchema,
  relayFileContentSchema,
  relayFileTreeSchema,
  relayConsoleCommandResultSchema,
  relayConsoleSchema,
  relayConsoleStreamEventSchema,
} from "@workspace/contracts"
import { Effect, Result } from "effect"
import { z } from "zod"

import { parseArguments, type CliArguments } from "./args.js"
import {
  normalizeKilnUrl,
  removeSessionEffect,
  resolveSessionEffect,
  saveSessionEffect,
  type KilnSession,
} from "./config.js"
import { CliCommandError, commandError } from "./errors.js"
import {
  apiJsonEffect,
  apiResponseEffect,
  CLI_LONG_OPERATION_TIMEOUT_MS,
  publicJsonEffect,
} from "./http.js"
import type { CliRequestInit } from "./http.js"
import { prepareFollowLogOutput } from "./logs.js"
import {
  formatBytes,
  reportErrorEffect,
  writeLine,
  writeTable,
  writeText,
} from "./output.js"
import { downloadSftpFileEffect, uploadSftpFileEffect } from "./sftp.js"
import release from "../../../release.json" with { type: "json" }

const VERSION = process.env.KILN_VERSION?.trim() || release.releaseLine

const powerResponseSchema = z.object({
  instance: z
    .object({ id: z.string(), name: z.string(), state: z.string() })
    .passthrough(),
  relayId: z.string(),
})
const whoamiSchema = z.object({
  credential: z.object({
    id: z.uuid(),
    mode: z.enum(["full_access", "read_only"]),
  }),
  user: z.object({ email: z.email(), id: z.string(), name: z.string() }),
})

const program = Effect.try({
  try: () => parseArguments(process.argv.slice(2)),
  catch: (cause) =>
    cause instanceof CliCommandError
      ? cause
      : commandError({
          cause,
          code: "invalid_arguments",
          exitCode: 2,
          message: "The CLI arguments are invalid.",
        }),
}).pipe(
  Effect.flatMap((args) => runCommandEffect(args)),
  Effect.catch((cause) =>
    reportErrorEffect(
      cause instanceof CliCommandError
        ? cause
        : commandError({
            cause,
            code: "unexpected_error",
            message: "The CLI stopped unexpectedly.",
          })
    )
  ),
  Effect.withSpan("kiln.cli")
)

const runCommandEffect = Effect.fn("cli.command")(function* (
  args: CliArguments
) {
  if (args.version) {
    writeLine(`kiln ${VERSION}`)
    return
  }
  if (args.help || args.command.length === 0 || args.command[0] === "help") {
    writeHelp()
    return
  }

  const [group, action, ...rest] = args.command
  if (group === "login") {
    yield* loginEffect(args, action)
    return
  }
  if (group === "logout") {
    yield* logoutEffect(args)
    return
  }

  const session = yield* resolveSessionEffect(args)
  if (group === "whoami") {
    const result = yield* apiJsonEffect(
      session,
      "/api/cli/v1/whoami",
      whoamiSchema
    )
    writeLine(`Name: ${result.user.name}`)
    writeLine(`Email: ${result.user.email}`)
    writeLine(`Access: ${result.credential.mode.replace("_", " ")}`)
    writeLine(`Profile: ${session.profile}`)
    writeLine(`Hearth: ${session.url}`)
    return
  }
  if (group === "servers" && action === "list") {
    const result = yield* apiJsonEffect(
      session,
      "/api/cli/v1/servers",
      cliServersResponseSchema
    )
    if (result.servers.length === 0) {
      writeLine("No servers found.")
    } else {
      writeTable(
        ["NAME", "STATE", "RELAY", "ID"],
        result.servers.map((server) => [
          server.name,
          server.state,
          server.relayName,
          server.id,
        ])
      )
    }
    return
  }
  if (group === "server" && action === "power") {
    const [serverReference, powerAction] = rest
    const target = yield* parseServerReferenceEffect(serverReference)
    const parsedAction = z
      .enum(["start", "stop", "restart", "kill"])
      .safeParse(powerAction)
    if (!parsedAction.success) {
      return yield* invalidUsage(
        "Usage: kiln server power <relayId:instanceId> <start|stop|restart|kill>"
      )
    }
    const result = yield* apiJsonEffect(
      session,
      "/api/cli/v1/power",
      powerResponseSchema,
      jsonRequest(
        "POST",
        { ...target, action: parsedAction.data },
        CLI_LONG_OPERATION_TIMEOUT_MS
      )
    )
    writeLine(`${result.instance.name} is ${result.instance.state}.`)
    return
  }
  if (group === "server" && action === "console") {
    const [serverReference, ...commandParts] = rest
    const target = yield* parseServerReferenceEffect(serverReference)
    const command = commandParts.length
      ? commandParts.join(" ")
      : (yield* readStdinEffect()).trim()
    if (!command) return yield* invalidUsage("A console command is required.")
    yield* apiJsonEffect(
      session,
      "/api/cli/v1/console",
      relayConsoleCommandResultSchema,
      jsonRequest("POST", { ...target, command })
    )
    writeLine("Command sent.")
    return
  }
  if (group === "server" && action === "logs") {
    const target = yield* parseServerReferenceEffect(rest[0])
    yield* logsEffect(args, session, target)
    return
  }
  if (group === "files") {
    yield* filesEffect(session, action, rest)
    return
  }
  return yield* invalidUsage(`Unknown command: ${args.command.join(" ")}`)
})

const loginEffect = Effect.fn("cli.login")(function* (
  args: CliArguments,
  positionalUrl?: string
) {
  const url = yield* Effect.try({
    try: () => normalizeKilnUrl(args.url || positionalUrl || "kiln.site"),
    catch: (cause) =>
      cause instanceof CliCommandError
        ? cause
        : commandError({
            cause,
            code: "invalid_url",
            exitCode: 2,
            message: "The Kiln URL is invalid.",
          }),
  })
  const profile = args.profile || "default"
  const name = args.name?.trim() || `${hostname()} (${platform()}/${arch()})`
  const device = yield* publicJsonEffect(
    url,
    "/api/cli/auth/device",
    cliDeviceCodeResponseSchema,
    jsonRequest("POST", { name })
  )
  writeLine("Complete sign-in in your browser.")
  writeLine(`URL: ${device.verificationUriComplete}`)
  writeLine(`Code: ${device.userCode}`)
  if (!args.noOpen && process.stdin.isTTY && process.stdout.isTTY) {
    yield* openBrowserEffect(device.verificationUriComplete).pipe(
      Effect.catch(() => Effect.void)
    )
  }
  const token = yield* pollForTokenEffect(url, device)
  yield* saveSessionEffect({
    profile,
    token: token.accessToken,
    url,
  })
  writeLine(`Logged in to ${url} with profile "${profile}".`)
})

const pollForTokenEffect = Effect.fn("cli.login.poll")(function* (
  url: string,
  device: z.infer<typeof cliDeviceCodeResponseSchema>
) {
  let delaySeconds = device.interval
  for (;;) {
    yield* Effect.sleep(`${delaySeconds} seconds`)
    const attempt = yield* Effect.result(
      publicJsonEffect(
        url,
        "/api/cli/auth/token",
        cliDeviceTokenResponseSchema,
        jsonRequest("POST", { deviceCode: device.deviceCode })
      )
    )
    if (Result.isSuccess(attempt)) return attempt.success
    if (attempt.failure.code === "authorization_pending") continue
    if (attempt.failure.code === "slow_down") {
      delaySeconds = Math.min(delaySeconds + 2, 15)
      continue
    }
    return yield* attempt.failure
  }
})

const logoutEffect = Effect.fn("cli.logout")(function* (args: CliArguments) {
  const session = yield* resolveSessionEffect(args).pipe(Effect.option)
  if (session._tag === "Some") {
    yield* apiJsonEffect(
      session.value,
      "/api/cli/v1/credential",
      z.object({ revoked: z.literal(true) }),
      { method: "DELETE" }
    ).pipe(Effect.catch(() => Effect.void))
  }
  const result = yield* removeSessionEffect(args.profile)
  writeLine(
    result.removed
      ? `Logged out of profile "${result.profile}".`
      : `Profile "${result.profile}" was not logged in.`
  )
})

const logsEffect = Effect.fn("cli.logs")(function* (
  args: CliArguments,
  session: KilnSession,
  target: { instanceId: string; relayId: string }
) {
  const query = targetQuery(target)
  query.set("limit", String(args.limit))
  if (!args.follow) {
    const result = yield* apiJsonEffect(
      session,
      `/api/cli/v1/logs?${query}`,
      relayConsoleSchema
    )
    for (const line of result.lines) writeLine(line.text)
    return
  }
  query.set("follow", "true")
  const response = yield* apiResponseEffect(
    session,
    `/api/cli/v1/logs?${query}`,
    { headers: { Accept: "application/x-ndjson" }, timeoutMs: null }
  )
  if (!response.body) {
    return yield* commandError({
      code: "invalid_response",
      message: "Hearth did not return a log stream.",
    })
  }
  const historyQuery = targetQuery(target)
  historyQuery.set("limit", String(args.limit))
  const history = yield* apiJsonEffect(
    session,
    `/api/cli/v1/logs?${historyQuery}`,
    relayConsoleSchema
  )
  const output = prepareFollowLogOutput(history.lines, args.limit)
  for (const line of output.initialLines) writeLine(line.text)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ""
  for (;;) {
    const chunk = yield* Effect.tryPromise({
      try: () => reader.read(),
      catch: (cause) =>
        commandError({
          cause,
          code: "stream_interrupted",
          message: "The server log stream was interrupted.",
          retryable: true,
        }),
    })
    buffered += decoder.decode(chunk.value, { stream: !chunk.done })
    const records = buffered.split("\n")
    buffered = records.pop() ?? ""
    for (const record of records) {
      if (!record) continue
      const event = yield* parseConsoleEventEffect(record)
      const line = output.liveLine(event)
      if (line) writeLine(line.text)
    }
    if (chunk.done) break
  }
})

const filesEffect = Effect.fn("cli.files")(function* (
  session: KilnSession,
  action: string | undefined,
  rest: Array<string>
) {
  const target = yield* parseServerReferenceEffect(rest[0])
  if (action === "list") {
    const query = targetQuery(target)
    query.set("path", rest[1] || ".")
    const result = yield* apiJsonEffect(
      session,
      `/api/cli/v1/files/tree?${query}`,
      relayFileTreeSchema
    )
    if (result.paths.length === 0) {
      writeLine("No files found.")
    } else {
      writeTable(
        ["PATH", "SIZE"],
        result.paths.map((path) => [
          path,
          result.sizes[path] === undefined
            ? "-"
            : formatBytes(result.sizes[path]),
        ])
      )
      if (result.truncated) {
        writeLine()
        writeLine(`Showing ${result.paths.length} of ${result.total} entries.`)
      }
    }
    return
  }
  if (action === "read") {
    const path = yield* requiredPathEffect(rest[1])
    const query = targetQuery(target)
    query.set("path", path)
    const result = yield* apiJsonEffect(
      session,
      `/api/cli/v1/files/content?${query}`,
      relayFileContentSchema
    )
    writeText(result.content)
    return
  }
  if (action === "write") {
    const path = yield* requiredPathEffect(rest[1])
    const source = rest[2] || "-"
    const content =
      source === "-"
        ? yield* readStdinEffect()
        : yield* Effect.tryPromise({
            try: () => readFile(source, "utf8"),
            catch: (cause) =>
              commandError({
                cause,
                code: "local_file_unavailable",
                exitCode: 2,
                message: `Could not read ${source}.`,
              }),
          })
    const result = yield* apiJsonEffect(
      session,
      "/api/cli/v1/files/content",
      relayFileContentSchema,
      jsonRequest(
        "PUT",
        { ...target, content, path },
        CLI_LONG_OPERATION_TIMEOUT_MS
      )
    )
    writeLine(`Wrote ${result.path} (${formatBytes(result.decodedSize)}).`)
    return
  }
  if (action === "download" || action === "upload") {
    const connection = yield* sftpConnectionEffect(session, target)
    if (action === "download") {
      const remotePath = yield* requiredPathEffect(rest[1])
      const result = yield* downloadSftpFileEffect({
        connection,
        localPath: rest[2] || basename(remotePath),
        remotePath,
        session,
      })
      writeLine(
        `Downloaded ${result.remotePath} to ${result.localPath} (${formatBytes(result.bytes)}).`
      )
      return
    }
    const localPath = rest[1]
    if (!localPath)
      return yield* invalidUsage("A local upload path is required.")
    const result = yield* uploadSftpFileEffect({
      connection,
      localPath,
      remotePath: rest[2] || basename(localPath),
      session,
    })
    writeLine(
      `Uploaded ${result.localPath} to ${result.remotePath} (${formatBytes(result.bytes)}).`
    )
    return
  }
  return yield* invalidUsage(
    "Usage: kiln files <list|read|write|download|upload> <server> ..."
  )
})

function sftpConnectionEffect(
  session: KilnSession,
  target: { instanceId: string; relayId: string }
) {
  return apiJsonEffect(
    session,
    `/api/cli/v1/sftp?${targetQuery(target)}`,
    cliSftpResponseSchema
  )
}

const parseServerReferenceEffect = Effect.fn("cli.serverReference.parse")(
  function* (value: string | undefined) {
    const parsed = cliServerReferenceSchema.safeParse(value)
    if (!parsed.success) {
      return yield* commandError({
        code: "invalid_arguments",
        exitCode: 2,
        message:
          "Server references use relayId:instanceId. Run `kiln servers list` to discover them.",
      })
    }
    const separator = parsed.data.indexOf(":")
    return {
      instanceId: parsed.data.slice(separator + 1),
      relayId: parsed.data.slice(0, separator),
    }
  }
)

const requiredPathEffect = Effect.fn("cli.path.required")(function* (
  value: string | undefined
) {
  if (value) return value
  return yield* commandError({
    code: "invalid_arguments",
    exitCode: 2,
    message: "A remote file path is required.",
  })
})

function targetQuery(target: { instanceId: string; relayId: string }) {
  return new URLSearchParams(target)
}

function jsonRequest(
  method: string,
  body: unknown,
  timeoutMs?: number
): CliRequestInit {
  return { body: JSON.stringify(body), method, timeoutMs }
}

const readStdinEffect = Effect.fn("cli.stdin.read")(function* () {
  return yield* Effect.tryPromise({
    try: async () => {
      const chunks: Array<Buffer> = []
      let size = 0
      for await (const chunk of process.stdin) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.byteLength
        if (size > 16 * 1024 * 1024) {
          throw new Error("input_too_large")
        }
        chunks.push(buffer)
      }
      return Buffer.concat(chunks).toString("utf8")
    },
    catch: (cause) =>
      commandError({
        cause,
        code:
          cause instanceof Error && cause.message === "input_too_large"
            ? "input_too_large"
            : "stdin_failed",
        exitCode: 2,
        message:
          cause instanceof Error && cause.message === "input_too_large"
            ? "Standard input exceeds the 16 MiB CLI limit."
            : "Could not read standard input.",
      }),
  })
})

const parseConsoleEventEffect = Effect.fn("cli.logs.parseEvent")(function* (
  record: string
) {
  const event = yield* Effect.try({
    try: () => relayConsoleStreamEventSchema.parse(JSON.parse(record)),
    catch: (cause) =>
      commandError({
        cause,
        code: "invalid_response",
        message: "Hearth returned an invalid log stream event.",
      }),
  })
  return event
})

function openBrowserEffect(url: string) {
  return Effect.try({
    try: () => {
      const command =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "cmd"
            : "xdg-open"
      const parameters =
        process.platform === "win32" ? ["/c", "start", "", url] : [url]
      const child = spawn(command, parameters, {
        detached: true,
        stdio: "ignore",
      })
      child.unref()
    },
    catch: (cause) =>
      commandError({
        cause,
        code: "browser_open_failed",
        message: "Could not open the browser automatically.",
      }),
  })
}

function invalidUsage(message: string) {
  return commandError({
    code: "invalid_arguments",
    exitCode: 2,
    message,
  })
}

function writeHelp(): void {
  writeText(`Kiln CLI ${VERSION}

Manage Kiln and self-hosted Hearth servers.

Usage:
  kiln <command> [options]

Commands:
  login [url]                              Sign in to Kiln or Hearth
  logout                                  Sign out of the active profile
  whoami                                  Show the current account
  servers list                            List available servers
  server power <server> <action>          Start, stop, restart, or kill a server
  server logs <server>                    Show server logs
  server console <server> [command]       Send a console command
  files list <server> [path]              List files
  files read <server> <remote>            Print a file
  files write <server> <remote> [local|-] Write a file
  files download <server> <remote> [local] Download a file
  files upload <server> <local> [remote]  Upload a file

Options:
  -f, --follow        Follow server logs
  -h, --help          Show help
      --limit <n>     Limit log history (1-10000)
      --name <name>   Name this CLI credential
      --no-open       Do not open a browser during login
      --profile <id>  Use a named profile
      --token <token> Use a token without saving it
      --url <url>     Use a specific Kiln or Hearth URL
  -v, --version       Show the CLI version

Environment:
  KILN_URL, KILN_TOKEN, KILN_CONFIG
`)
}

Effect.runFork(
  program.pipe(
    Effect.catchCause(() =>
      Effect.sync(() => {
        process.stderr.write("Error: The CLI stopped unexpectedly.\n")
        process.exitCode = 1
      })
    )
  )
)
