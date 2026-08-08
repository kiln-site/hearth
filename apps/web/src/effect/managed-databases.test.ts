import { assert, describe, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import type { ResultSetHeader } from "mysql2/promise"

import { Database } from "./database"
import { deleteManagedDatabaseRecordEffect } from "./managed-databases"

const emptyResult: ResultSetHeader = {
  affectedRows: 0,
  changedRows: 0,
  constructor: { name: "ResultSetHeader" },
  fieldCount: 0,
  info: "",
  insertId: 0,
  serverStatus: 0,
  warningStatus: 0,
}

const statements: Array<{
  sql: string
  values: ReadonlyArray<unknown>
}> = []

const databaseLayer = Layer.succeed(Database)({
  execute: () => Effect.die("Unexpected standalone database write"),
  queryRows: () => Effect.die("Unexpected database query"),
  transaction: (_operation, run) =>
    run({
      execute: (sql, values) =>
        Effect.sync(() => {
          statements.push({ sql, values: values ?? [] })
          return emptyResult
        }),
      queryRows: () => Effect.succeed([]),
    }),
})

describe("managed database cleanup", () => {
  layer(databaseLayer)((it) => {
    it.effect("removes grants, pending invitations, and credentials", () =>
      Effect.gen(function* () {
        statements.length = 0

        yield* deleteManagedDatabaseRecordEffect("relay-one", "database-one")

        assert.strictEqual(statements.length, 3)
        assert.include(statements[0]?.sql, "database_id = ?")
        assert.include(statements[0]?.sql, "accepted_at IS NULL")
        assert.include(statements[0]?.sql, "revoked_at IS NULL")
        assert.include(statements[0]?.sql, "expires_at > CURRENT_TIMESTAMP(3)")
        assert.deepEqual(statements[0]?.values, ["relay-one", "database-one"])
        assert.include(statements[1]?.sql, "database_id = ?")
        assert.deepEqual(statements[1]?.values, ["relay-one", "database-one"])
        assert.include(statements[2]?.sql, "DELETE FROM")
        assert.include(statements[2]?.sql, "resource_type = 'database'")
        assert.deepEqual(statements[2]?.values, ["relay-one", "database-one"])
      })
    )
  })
})
