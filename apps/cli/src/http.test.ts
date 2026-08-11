import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Fiber } from "effect"
import { afterEach, vi } from "vite-plus/test"

import type { KilnSession } from "./config.js"
import { apiResponseEffect, CLI_LONG_OPERATION_TIMEOUT_MS } from "./http.js"

const session: KilnSession = {
  profile: "test",
  token: "kiln_cli_test",
  url: "https://kiln.example.test",
}

describe("CLI HTTP requests", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.effect("keeps followed log streams free of an operation deadline", () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response()
    )
    vi.stubGlobal("fetch", fetchMock)

    return Effect.gen(function* () {
      yield* apiResponseEffect(session, "/api/cli/v1/logs", {
        timeoutMs: null,
      })

      const [, init] = fetchMock.mock.calls[0] ?? []
      assert.instanceOf(init?.signal, AbortSignal)
      assert.isFalse(init?.signal?.aborted ?? true)
    })
  })

  it.effect("combines caller cancellation with the operation deadline", () => {
    const caller = new AbortController()
    const addEventListener = vi.spyOn(caller.signal, "addEventListener")
    const removeEventListener = vi.spyOn(caller.signal, "removeEventListener")
    const scheduleTimeout = vi.spyOn(globalThis, "setTimeout")
    const cancelTimeout = vi.spyOn(globalThis, "clearTimeout")
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            requestSignal = init?.signal ?? undefined
            if (requestSignal?.aborted) {
              reject(requestSignal.reason)
              return
            }
            requestSignal?.addEventListener(
              "abort",
              () => reject(requestSignal?.reason),
              { once: true }
            )
          })
      )
    )

    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        apiResponseEffect(session, "/api/cli/v1/power", {
          signal: caller.signal,
          timeoutMs: CLI_LONG_OPERATION_TIMEOUT_MS,
        }).pipe(Effect.exit)
      )
      yield* Effect.yieldNow

      assert.notStrictEqual(requestSignal, caller.signal)
      assert.isTrue(
        scheduleTimeout.mock.calls.some(
          ([, delay]) => delay === CLI_LONG_OPERATION_TIMEOUT_MS
        )
      )
      caller.abort(new DOMException("caller stopped", "AbortError"))
      yield* Fiber.join(fiber)

      assert.isTrue(requestSignal?.aborted ?? false)
      assert.isAbove(addEventListener.mock.calls.length, 0)
      assert.isAbove(removeEventListener.mock.calls.length, 0)
      assert.isAbove(cancelTimeout.mock.calls.length, 0)
      assert.isAbove(CLI_LONG_OPERATION_TIMEOUT_MS, 180_000)
    })
  })

  it.effect("aborts fetch when the Effect is interrupted", () => {
    let requestSignal: AbortSignal | undefined

    return Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async (_input: RequestInfo | URL, init?: RequestInit) =>
            await new Promise<Response>((_resolve, reject) => {
              requestSignal = init?.signal ?? undefined
              Effect.runFork(Deferred.succeed(started, undefined))
              requestSignal?.addEventListener(
                "abort",
                () => reject(requestSignal?.reason),
                { once: true }
              )
            })
        )
      )
      const fiber = yield* Effect.forkChild(
        apiResponseEffect(session, "/api/cli/v1/logs", {
          timeoutMs: null,
        })
      )
      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)

      assert.isTrue(requestSignal?.aborted ?? false)
    })
  })
})
