import { createFileRoute } from "@tanstack/react-router"
import {
  cliConsoleRequestSchema,
  cliFileWriteRequestSchema,
  cliPowerRequestSchema,
  cliTargetSchema,
  relayConsoleStreamEventSchema,
} from "@workspace/contracts"
import { Effect } from "effect"

import {
  authenticateCliTokenEffect,
  bearerToken,
  revokeCliCredentialEffect,
  type CliPrincipal,
} from "@/effect/cli-access"
import {
  getCliConsoleHistoryEffect,
  getCliFileTreeEffect,
  getCliSftpConnectionEffect,
  listCliServersEffect,
  performCliPowerActionEffect,
  readCliFileEffect,
  sendCliConsoleCommandEffect,
  writeCliFileEffect,
} from "@/effect/cli-api"
import { CliAccessError } from "@/effect/errors"
import { runAppEffect } from "@/effect/runtime"
import type { AppCache } from "@/effect/cache"
import type { Database } from "@/effect/database"
import { cliFailureResponse, cliJsonResponse } from "@/lib/cli-http"
import { openHearthRelayConsoleStream } from "@/server/relay-console-proxy"

const encoder = new TextEncoder()

export const Route = createFileRoute("/api/cli/v1/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const principal = await authenticateRequest(request)
        if (principal instanceof Response) return principal
        const endpoint = endpointName(request.url)

        if (endpoint === "whoami") {
          return cliJsonResponse({
            credential: {
              id: principal.credentialId,
              mode: principal.mode,
            },
            user: {
              email: principal.user.email,
              id: principal.user.id,
              name: principal.user.name,
            },
          })
        }
        if (endpoint === "capabilities") {
          return cliJsonResponse({
            apiVersion: "v1",
            commands: [
              "servers.list",
              "server.power",
              "server.logs",
              "server.console",
              "files.list",
              "files.read",
              "files.write",
              "files.download",
              "files.upload",
            ],
            mode: principal.mode,
            output: "json",
            streaming: "ndjson",
          })
        }
        if (endpoint === "servers") {
          return runCliEffect(
            "cli.http.servers",
            listCliServersEffect(principal)
          )
        }

        const url = new URL(request.url)
        const target = targetFromSearch(url)
        if (target instanceof Response) return target
        if (endpoint === "logs") {
          const limit = boundedLimit(url.searchParams.get("limit"))
          if (url.searchParams.get("follow") === "true") {
            return streamConsole(request, principal, { ...target, limit })
          }
          return runCliEffect(
            "cli.http.logs",
            getCliConsoleHistoryEffect(principal, { ...target, limit })
          )
        }
        if (endpoint === "files/tree") {
          return runCliEffect(
            "cli.http.files.list",
            getCliFileTreeEffect(principal, {
              ...target,
              path: url.searchParams.get("path") || ".",
            })
          )
        }
        if (endpoint === "files/content") {
          return runCliEffect(
            "cli.http.files.read",
            readCliFileEffect(principal, {
              ...target,
              path: url.searchParams.get("path"),
            })
          )
        }
        if (endpoint === "sftp") {
          return runCliEffect(
            "cli.http.sftp",
            getCliSftpConnectionEffect(principal, target)
          )
        }
        return notFound()
      },
      POST: async ({ request }) => {
        const principal = await authenticateRequest(request)
        if (principal instanceof Response) return principal
        const endpoint = endpointName(request.url)
        const body = await requestBody(request)
        if (body instanceof Response) return body

        if (endpoint === "power") {
          return runCliEffect(
            "cli.http.power",
            decodeBody(cliPowerRequestSchema, body.value).pipe(
              Effect.flatMap((input) =>
                performCliPowerActionEffect(principal, input)
              )
            )
          )
        }
        if (endpoint === "console") {
          return runCliEffect(
            "cli.http.console",
            decodeBody(cliConsoleRequestSchema, body.value).pipe(
              Effect.flatMap((input) =>
                sendCliConsoleCommandEffect(principal, input)
              )
            )
          )
        }
        return notFound()
      },
      PUT: async ({ request }) => {
        const principal = await authenticateRequest(request)
        if (principal instanceof Response) return principal
        if (endpointName(request.url) !== "files/content") return notFound()
        const body = await requestBody(request)
        if (body instanceof Response) return body
        return runCliEffect(
          "cli.http.files.write",
          decodeBody(cliFileWriteRequestSchema, body.value).pipe(
            Effect.flatMap((input) => writeCliFileEffect(principal, input))
          )
        )
      },
      DELETE: async ({ request }) => {
        const principal = await authenticateRequest(request)
        if (principal instanceof Response) return principal
        if (endpointName(request.url) !== "credential") return notFound()
        return runCliEffect(
          "cli.http.credential.revoke",
          revokeCliCredentialEffect({
            credentialId: principal.credentialId,
            user: principal.user,
          })
        )
      },
    },
  },
})

async function authenticateRequest(
  request: Request
): Promise<CliPrincipal | Response> {
  const token = bearerToken(request.headers) ?? ""
  return runAppEffect(
    "cli.http.authenticate",
    authenticateCliTokenEffect(token).pipe(
      Effect.match({
        onFailure: cliFailureResponse,
        onSuccess: (principal) => principal,
      })
    )
  )
}

function runCliEffect<TResult, TError>(
  name: string,
  effect: Effect.Effect<TResult, TError, AppCache | Database>
): Promise<Response> {
  return runAppEffect(
    name,
    effect.pipe(
      Effect.match({
        onFailure: cliFailureResponse,
        onSuccess: (value) => cliJsonResponse(value),
      })
    )
  )
}

function decodeBody<TValue>(
  schema: { parse: (value: unknown) => TValue },
  value: unknown
) {
  return Effect.try({
    try: () => schema.parse(value),
    catch: (cause) =>
      CliAccessError.make({
        code: "invalid_request",
        message: "The CLI request contains invalid input.",
        retryable: false,
        cause,
      }),
  })
}

async function requestBody(
  request: Request
): Promise<{ value: unknown } | Response> {
  return Effect.runPromise(
    Effect.tryPromise({
      try: () => request.json(),
      catch: (cause) => cause,
    }).pipe(
      Effect.match({
        onFailure: (cause) =>
          cliFailureResponse(
            CliAccessError.make({
              code: "invalid_request",
              message: "The request body must be valid JSON.",
              retryable: false,
              cause,
            })
          ),
        onSuccess: (body) => ({ value: body }),
      })
    )
  )
}

function targetFromSearch(url: URL) {
  const parsed = cliTargetSchema.safeParse({
    instanceId: url.searchParams.get("instanceId"),
    relayId: url.searchParams.get("relayId"),
  })
  return parsed.success
    ? parsed.data
    : cliFailureResponse(
        CliAccessError.make({
          code: "invalid_request",
          message: "A valid relayId and instanceId are required.",
          retryable: false,
        })
      )
}

function endpointName(requestUrl: string): string {
  const pathname = new URL(requestUrl).pathname
  return pathname.split("/api/cli/v1/")[1]?.replace(/\/$/u, "") ?? ""
}

function boundedLimit(value: string | null): number {
  const parsed = Number(value ?? 2_000)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 10_000
    ? parsed
    : 2_000
}

async function streamConsole(
  request: Request,
  principal: CliPrincipal,
  input: { instanceId: string; limit: number; relayId: string }
): Promise<Response> {
  const authorization = await runCliEffect(
    "cli.http.logs.authorize",
    getCliConsoleHistoryEffect(principal, input)
  )
  if (!authorization.ok) return authorization

  const lifecycle = new AbortController()
  const abort = () => lifecycle.abort()
  request.signal.addEventListener("abort", abort, { once: true })
  if (request.signal.aborted) abort()
  const iterator = openHearthRelayConsoleStream({
    instanceId: input.instanceId,
    relayId: input.relayId,
    signal: lifecycle.signal,
    user: principal.user,
  })
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = await iterator.next()
      if (result.done) {
        controller.close()
        return
      }
      const event = relayConsoleStreamEventSchema.parse(result.value)
      controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
    },
    async cancel() {
      lifecycle.abort()
      request.signal.removeEventListener("abort", abort)
      await iterator.return(undefined)
    },
  })
  return new Response(body, {
    headers: {
      "Cache-Control": "no-store, no-transform",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  })
}

function notFound(): Response {
  return cliFailureResponse(
    CliAccessError.make({
      code: "not_found",
      message: "The CLI API endpoint was not found.",
      retryable: false,
    })
  )
}
