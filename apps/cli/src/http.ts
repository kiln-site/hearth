import { cliErrorResponseSchema } from "@workspace/contracts"
import { Effect } from "effect"
import type { z } from "zod"

import type { KilnSession } from "./config.js"
import { commandError } from "./errors.js"

export const CLI_LONG_OPERATION_TIMEOUT_MS = 370_000

export interface CliRequestInit extends RequestInit {
  timeoutMs?: number | null
}

export const apiJsonEffect = Effect.fn("cli.http.json")(function* <TValue>(
  session: KilnSession,
  path: string,
  schema: z.ZodType<TValue>,
  init?: CliRequestInit
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
  init?: CliRequestInit
) {
  return yield* requestEffect(`${session.url}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
      "User-Agent": "kiln-cli/0.0.1",
      ...init?.headers,
    },
  })
})

export const publicJsonEffect = Effect.fn("cli.http.publicJson")(function* <
  TValue,
>(url: string, path: string, schema: z.ZodType<TValue>, init?: CliRequestInit) {
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

export const publicResponseEffect = Effect.fn("cli.http.publicResponse")(
  function* (url: string, init?: CliRequestInit) {
    return yield* requestEffect(url, {
      ...init,
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": "kiln-cli/0.0.1",
        ...init?.headers,
      },
    })
  }
)

function requestEffect(url: string, init: CliRequestInit) {
  const { timeoutMs = 30_000, ...requestInit } = init
  return Effect.tryPromise({
    try: (effectSignal) =>
      withRequestAbortSignal(
        effectSignal,
        requestInit.signal,
        timeoutMs,
        (signal) =>
          fetch(url, {
            ...requestInit,
            signal,
          })
      ),
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

function withRequestAbortSignal<TResult>(
  effectSignal: AbortSignal,
  callerSignal: AbortSignal | null | undefined,
  timeoutMs: number | null,
  run: (signal: AbortSignal) => PromiseLike<TResult>
): Promise<TResult> {
  const controller = new AbortController()
  const cleanups: Array<() => void> = []

  const follow = (signal: AbortSignal) => {
    if (controller.signal.aborted) return
    if (signal.aborted) {
      controller.abort(signal.reason)
      return
    }
    const onAbort = () => controller.abort(signal.reason)
    signal.addEventListener("abort", onAbort, { once: true })
    cleanups.push(() => signal.removeEventListener("abort", onAbort))
  }

  follow(effectSignal)
  if (
    callerSignal !== effectSignal &&
    callerSignal !== undefined &&
    callerSignal !== null
  ) {
    follow(callerSignal)
  }

  if (timeoutMs !== null && !controller.signal.aborted) {
    const timeout = setTimeout(
      () =>
        controller.abort(
          new DOMException("The operation timed out.", "TimeoutError")
        ),
      timeoutMs
    )
    cleanups.push(() => clearTimeout(timeout))
  }

  return Promise.resolve()
    .then(() => run(controller.signal))
    .finally(() => {
      cleanups.forEach((cleanup) => cleanup())
    })
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
