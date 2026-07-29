import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { vi } from "vite-plus/test"

vi.hoisted(() => {
  process.env.DB_HOST ??= "127.0.0.1"
  process.env.DB_NAME ??= "test"
  process.env.DB_PASSWORD ??= "test"
  process.env.DB_USERNAME ??= "test"
})

import { AppCache } from "@/effect/cache"
import { Database } from "@/effect/database"
import { DatabaseError } from "@/effect/errors"

const captureException = vi.hoisted(() => vi.fn())

vi.mock("@sentry/tanstackstart-react", () => ({
  captureException,
}))

import { finalizeInstanceDeletionEffect } from "./instance-deletion-cleanup"

describe("instance deletion cleanup", () => {
  it.effect(
    "reports access cleanup failure without failing a completed deletion",
    () => {
      const databaseFailure = DatabaseError.make({
        cause: new Error("database unavailable"),
        operation: "access.deleteInstance",
      })
      const cacheLayer = Layer.succeed(AppCache)({
        backend: "disabled",
        enabled: false,
        get: () => Effect.succeed(undefined),
        remove: () => Effect.void,
        set: () => Effect.void,
      })
      const databaseLayer = Layer.succeed(Database)({
        execute: () => Effect.die("Unexpected standalone database write"),
        queryRows: () => Effect.die("Unexpected database query"),
        transaction: () => Effect.fail(databaseFailure),
      })

      return Effect.gen(function* () {
        yield* finalizeInstanceDeletionEffect("relay-one", "instance-one")

        assert.strictEqual(captureException.mock.calls.length, 1)
        assert.strictEqual(captureException.mock.calls[0]?.[0], databaseFailure)
        assert.deepEqual(captureException.mock.calls[0]?.[1], {
          tags: {
            "kiln.instance_id": "instance-one",
            "kiln.operation": "access.deleteInstance",
            "kiln.relay_id": "relay-one",
          },
        })
      }).pipe(Effect.provide(Layer.merge(cacheLayer, databaseLayer)))
    }
  )
})
