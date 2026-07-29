import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import type { ResultSetHeader } from "mysql2/promise"

import { Database } from "@/effect/database"
import { deleteInstanceAccessEffect } from "@/lib/access-control"

describe("instance access cleanup", () => {
  it.effect("removes grants and pending invitations in one transaction", () => {
    const statements: Array<{
      sql: string
      values: ReadonlyArray<unknown>
    }> = []
    const databaseLayer = Layer.succeed(Database)({
      execute: () => Effect.die("Unexpected standalone database write"),
      queryRows: () => Effect.die("Unexpected database query"),
      transaction: (_operation, run) =>
        Effect.promise(() =>
          run({
            execute: async (sql, values) => {
              statements.push({ sql, values: values ?? [] })
              return {} as ResultSetHeader
            },
            queryRows: async () => [],
          })
        ),
    })

    return Effect.gen(function* () {
      yield* deleteInstanceAccessEffect("relay-one", "instance-one")

      assert.strictEqual(statements.length, 2)
      assert.include(statements[0]?.sql, "resource_type = 'instance'")
      assert.deepEqual(statements[0]?.values, ["relay-one", "instance-one"])
      assert.include(statements[1]?.sql, "accepted_at IS NULL")
      assert.include(statements[1]?.sql, "revoked_at IS NULL")
      assert.include(statements[1]?.sql, "expires_at > CURRENT_TIMESTAMP(3)")
      assert.deepEqual(statements[1]?.values, ["relay-one", "instance-one"])
    }).pipe(Effect.provide(databaseLayer))
  })
})
