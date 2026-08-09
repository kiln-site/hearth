import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
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

  it.effect("keeps followed log streams free of a client deadline", () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response()
    )
    vi.stubGlobal("fetch", fetchMock)

    return Effect.gen(function* () {
      yield* apiResponseEffect(session, "/api/cli/v1/logs", {
        timeoutMs: null,
      })

      const [, init] = fetchMock.mock.calls[0] ?? []
      assert.isUndefined(init?.signal)
    })
  })

  it.effect("uses the requested deadline for long-running operations", () => {
    const signal = new AbortController().signal
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response())
    )

    return Effect.gen(function* () {
      yield* apiResponseEffect(session, "/api/cli/v1/power", {
        timeoutMs: CLI_LONG_OPERATION_TIMEOUT_MS,
      })

      assert.deepEqual(timeout.mock.calls, [[CLI_LONG_OPERATION_TIMEOUT_MS]])
      assert.isAbove(CLI_LONG_OPERATION_TIMEOUT_MS, 180_000)
    })
  })
})
