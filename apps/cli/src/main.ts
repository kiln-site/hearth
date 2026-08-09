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
import {
  reportErrorEffect,
  writeEvent,
  writeResult,
  type OutputMode,
} from "./output.js"
import { downloadSftpFileEffect, uploadSftpFileEffect } from "./sftp.js"
import release from "../../../release.json" with { type: "json" }

const VERSION = process.env.KILN_VERSION?.trim() || release.releaseLine

const genericObjectSchema = z.record(z.string(), z.unknown())
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

const fallbackOutput: OutputMode = process.argv.includes("human")
  ? "human"
  : "json"

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
          }),
      fallbackOutput
    )
  ),
  Effect.withSpan("kiln.cli")
)

const runCommandEffect = Effect.fn("cli.command")(function* (
  args: CliArguments
) {
  if (args.version) {
    writeResult({ name: "kiln", version: VERSION }, args.output)
    return
  }
  if (args.help || args.command.length === 0 || args.command[0] === "help") {
    writeHelp(args.output)
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
    writeResult(result, args.output)
    return
  }
  if (group === "capabilities") {
    const result = yield* apiJsonEffect(
      session,
      "/api/cli/v1/capabilities",
      genericObjectSchema
    )
    writeResult(result, args.output)
    return
  }
  if (group === "servers" && action === "list") {
    const result = yield* apiJsonEffect(
      session,
      "/api/cli/v1/servers",
      cliServersResponseSchema
    )
    writeResult(result, args.output)
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
    writeResult(result, args.output)
    return
  }
  if (group === "server" && action === "console") {
    const [serverReference, ...commandParts] = rest
    const target = yield* parseServerReferenceEffect(serverReference)
    const command = commandParts.length
      ? commandParts.join(" ")
      : (yield* readStdinEffect()).trim()
    if (!command) return yield* invalidUsage("A console command is required.")
    const result = yield* apiJsonEffect(
      session,
      "/api/cli/v1/console",
      relayConsoleCommandResultSchema,
      jsonRequest("POST", { ...target, command })
    )
    writeResult(result, args.output)
    return
  }
  if (group === "server" && action === "logs") {
    const target = yield* parseServerReferenceEffect(rest[0])
    yield* logsEffect(args, session, target)
    return
  }
  if (group === "files") {
    yield* filesEffect(args, session, action, rest)
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
  writeEvent(
    {
      type: "authorization_required",
      expiresAt: device.expiresAt,
      userCode: device.userCode,
      verificationUri: device.verificationUriComplete,
    },
    args.output
  )
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
  writeEvent(
    {
      type: "authenticated",
      credential: token.credential,
      profile,
      url,
    },
    args.output
  )
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
  writeResult(result, args.output)
})

const logsEffect = Effect.fn("cli.logs")(function* (
  args: CliArguments,
  session: KilnSession,
  target: { instanceId: string; relayId: string }
) {
  const query = targetQuery(target)
  query.set("limit", String(args.limit))
  if (args.follow) query.set("follow", "true")
  if (!args.follow) {
    const result = yield* apiJsonEffect(
      session,
      `/api/cli/v1/logs?${query}`,
      relayConsoleSchema
    )
    if (args.output === "human") {
      for (const line of result.lines) process.stdout.write(`${line.text}\n`)
    } else writeResult(result, args.output)
    return
  }
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
      if (args.output === "human") {
        const parsed = z
          .object({
            type: z.string(),
            line: z.object({ text: z.string() }).optional(),
          })
          .safeParse(JSON.parse(record))
        if (parsed.success && parsed.data.line) {
          process.stdout.write(`${parsed.data.line.text}\n`)
        }
      } else process.stdout.write(`${record}\n`)
    }
    if (chunk.done) break
  }
})

const filesEffect = Effect.fn("cli.files")(function* (
  args: CliArguments,
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
    writeResult(result, args.output)
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
    if (args.raw) process.stdout.write(result.content)
    else writeResult(result, args.output)
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
    writeResult(result, args.output)
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
      writeResult(result, args.output)
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
    writeResult(result, args.output)
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

function writeHelp(output: OutputMode): void {
  const help = {
    agentFirst: true,
    commands: [
      "kiln login [url] [--name name] [--no-open]",
      "kiln logout",
      "kiln whoami",
      "kiln capabilities",
      "kiln servers list",
      "kiln server power <server> <start|stop|restart|kill>",
      "kiln server logs <server> [--follow] [--limit n]",
      "kiln server console <server> [command]",
      "kiln files list <server> [path]",
      "kiln files read <server> <remote> [--raw]",
      "kiln files write <server> <remote> [local|-]",
      "kiln files download <server> <remote> [local]",
      "kiln files upload <server> <local> [remote]",
    ],
    environment: ["KILN_URL", "KILN_TOKEN", "KILN_CONFIG", "KILN_OUTPUT"],
    output: {
      default: "json",
      follow: "ndjson",
      human: "--output human",
    },
  }
  if (output === "json") writeResult(help, output)
  else {
    process.stdout.write(
      `Kiln CLI ${VERSION}\n\n${help.commands.join("\n")}\n\nJSON is the default output. Use --output human for readable output.\n`
    )
  }
}

Effect.runFork(
  program.pipe(
    Effect.catchCause(() =>
      Effect.sync(() => {
        process.stderr.write(
          `${JSON.stringify({
            error: {
              code: "unexpected_error",
              message: "The CLI stopped unexpectedly.",
              retryable: false,
            },
          })}\n`
        )
        process.exitCode = 1
      })
    )
  )
)
