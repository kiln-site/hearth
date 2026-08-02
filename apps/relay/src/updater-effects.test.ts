import { it as effectIt } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { describe, expect } from "vite-plus/test"

import { RelaySystemUpdateError } from "./effect/errors.js"
import {
  drainUpdateBatchEffect,
  retryContainerReplacementEffect,
} from "./updater-effects.js"

function replacementFailure(rollbackFailures: ReadonlyArray<string>) {
  return RelaySystemUpdateError.make({
    phase: "replace",
    reason: "Replacement failed",
    rollbackFailures,
  })
}

describe("updater batch draining", () => {
  effectIt.effect("processes a batch joined during the final idle wait", () =>
    Effect.gen(function* () {
      const events: Array<string> = []
      let processed = false
      let waits = 0

      yield* drainUpdateBatchEffect(
        () =>
          Effect.sync(() => {
            events.push("check")
            if (waits !== 2 || processed) return false
            processed = true
            events.push("process")
            return true
          }),
        Effect.sync(() => {
          waits += 1
          events.push("wait")
        })
      )

      expect(processed).toBe(true)
      expect(events.slice(0, 5)).toEqual([
        "check",
        "wait",
        "check",
        "wait",
        "check",
      ])
      expect(events).toContain("process")
    })
  )
})

describe("container replacement retries", () => {
  effectIt.effect("keeps the bounded three-attempt retry policy", () =>
    Effect.gen(function* () {
      let attempts = 0
      const failure = replacementFailure([])
      const fiber = yield* retryContainerReplacementEffect(
        Effect.suspend(() => {
          attempts += 1
          return Effect.fail(failure)
        })
      ).pipe(Effect.forkChild)

      yield* TestClock.adjust("3 seconds")
      const result = yield* Fiber.join(fiber).pipe(Effect.flip)

      expect(result).toBe(failure)
      expect(attempts).toBe(3)
    })
  )

  effectIt.effect("does not retry after rollback failure", () =>
    Effect.gen(function* () {
      let attempts = 0
      const failure = replacementFailure(["Could not restore backup"])

      const result = yield* retryContainerReplacementEffect(
        Effect.suspend(() => {
          attempts += 1
          return Effect.fail(failure)
        })
      ).pipe(Effect.flip)

      expect(result).toBe(failure)
      expect(attempts).toBe(1)
    })
  )
})
