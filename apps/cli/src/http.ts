import { cliErrorResponseSchema } from "@workspace/contracts"
import { Effect } from "effect"
import type { z } from "zod"

import type { KilnSession } from "./config.js"
import { commandError } from "./errors.js"

export const apiJsonEffect = Effect.fn("cli.http.json")(function* <TValue>(
  session: KilnSession,
  path: string,
  schema: z.ZodType<TValue>,
  init?: RequestInit
) {
  const response = yield* apiResponseEffect(session, path, init)
  const body = yield* decodeResponseJson(response)
  return yield* Effect.try({
    try: () => schema.parse(body),
    catch: (cause) =>
      commandError({
        cause,
        code: "invalid_response",
        message: "Hearth returned a response the CLI does not understand.",
      }),
  })
})

export const apiResponseEffect = Effect.fn("cli.http.request")(function* (
  session: KilnSession,
  path: string,
  init?: RequestInit
) {
  return yield* requestEffect(
    `${session.url}${path}`,
    {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json",
        "User-Agent": "kiln-cli/0.0.1",
        ...init?.headers,
      },
    },
    init?.signal ? undefined : 30_000
  )
})

export const publicJsonEffect = Effect.fn("cli.http.publicJson")(function* <
  TValue,
>(url: string, path: string, schema: z.ZodType<TValue>, init?: RequestInit) {
  const response = yield* requestEffect(`${url}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "kiln-cli/0.0.1",
      ...init?.headers,
    },
  })
  const body = yield* decodeResponseJson(response)
  return yield* Effect.try({
    try: () => schema.parse(body),
    catch: (cause) =>
      commandError({
        cause,
        code: "invalid_response",
        message: "Hearth returned a response the CLI does not understand.",
      }),
  })
})

function requestEffect(url: string, init: RequestInit, timeoutMs = 30_000) {
  return Effect.tryPromise({
    try: () =>
      fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      }),
    catch: (cause) =>
      commandError({
        cause,
        code: "network_error",
        exitCode: 5,
        message: `Could not reach ${new URL(url).origin}.`,
        retryable: true,
      }),
  }).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? Effect.succeed(response)
        : decodeResponseJson(response).pipe(
            Effect.flatMap((body) => {
              const parsed = cliErrorResponseSchema.safeParse(body)
              return Effect.fail(
                commandError({
                  code: parsed.success
                    ? parsed.data.error.code
                    : `http_${response.status}`,
                  exitCode:
                    response.status === 401
                      ? 3
                      : response.status === 403
                        ? 4
                        : 1,
                  message: parsed.success
                    ? parsed.data.error.message
                    : `Hearth returned HTTP ${response.status}.`,
                  retryable: parsed.success && parsed.data.error.retryable,
                })
              )
            })
          )
    )
  )
}

function decodeResponseJson(response: Response) {
  return Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) =>
      commandError({
        cause,
        code: "invalid_response",
        message: "Hearth returned invalid JSON.",
      }),
  })
}
