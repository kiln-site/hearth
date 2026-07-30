import { assert, beforeEach, describe, layer } from "@effect/vitest"
import { Deferred, Effect, Fiber } from "effect"
import { vi } from "vite-plus/test"

const database = vi.hoisted(() => {
  const result = {
    affectedRows: 1,
    changedRows: 0,
    constructor: { name: "ResultSetHeader" },
    fieldCount: 0,
    info: "",
    insertId: 0,
    serverStatus: 0,
    warningStatus: 0,
  }
  const connection = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    execute: vi.fn(async () => [result, []]),
    query: vi.fn(async () => [[], []]),
    release: vi.fn(),
    rollback: vi.fn(async () => undefined),
  }
  return {
    connection,
    getConnection: vi.fn(async () => connection),
  }
})

vi.mock("@/lib/database", () => ({
  databasePool: {
    getConnection: database.getConnection,
  },
}))

import { Database, DatabaseLive } from "@/effect/database"

describe("Database transactions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  layer(DatabaseLive)((it) => {
    it.effect("commits successful workflows and releases the connection", () =>
      Effect.gen(function* () {
        const service = yield* Database
        const result = yield* service.transaction(
          "database.test.success",
          (transaction) =>
            Effect.gen(function* () {
              yield* transaction.execute("UPDATE kiln_test SET value = 1")
              return 42
            })
        )

        assert.strictEqual(result, 42)
        assert.strictEqual(
          database.connection.beginTransaction.mock.calls.length,
          1
        )
        assert.strictEqual(database.connection.commit.mock.calls.length, 1)
        assert.strictEqual(database.connection.rollback.mock.calls.length, 0)
        assert.strictEqual(database.connection.release.mock.calls.length, 1)
      })
    )

    it.effect(
      "rolls back failed workflows and preserves their typed error",
      () =>
        Effect.gen(function* () {
          const service = yield* Database
          const failure = yield* service
            .transaction("database.test.failure", () =>
              Effect.fail("workflow failure")
            )
            .pipe(Effect.flip)

          assert.strictEqual(failure, "workflow failure")
          assert.strictEqual(database.connection.commit.mock.calls.length, 0)
          assert.strictEqual(database.connection.rollback.mock.calls.length, 1)
          assert.strictEqual(database.connection.release.mock.calls.length, 1)
        })
    )

    it.effect("rolls back and releases the connection when interrupted", () =>
      Effect.gen(function* () {
        const service = yield* Database
        const started = yield* Deferred.make<void>()
        const fiber = yield* Effect.forkChild(
          service.transaction("database.test.interrupt", () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never)
            )
          )
        )

        yield* Deferred.await(started)
        yield* Fiber.interrupt(fiber)
        yield* Fiber.await(fiber)

        assert.strictEqual(database.connection.commit.mock.calls.length, 0)
        assert.strictEqual(database.connection.rollback.mock.calls.length, 1)
        assert.strictEqual(database.connection.release.mock.calls.length, 1)
      })
    )
  })
})
