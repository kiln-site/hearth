import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import type { ResultSetHeader } from "mysql2/promise"

import { Database } from "@/effect/database"
import { syncInstanceRegistryEffect } from "@/lib/instance-registry"

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

describe("instance registry sync", () => {
  it.effect(
    "does not write non-unique Relay names into the registry key",
    () => {
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
            queryRows: () => Effect.die("Unexpected transaction query"),
          }),
      })

      return Effect.gen(function* () {
        yield* syncInstanceRegistryEffect("relay-one", [
          { id: "instance-one", name: "Survival" },
          { id: "instance-two", name: "Survival" },
        ])

        const insert = statements[0]
        assert.isDefined(insert)
        assert.include(insert.sql, "(relay_id, instance_id, display_name)")
        assert.include(insert.sql, "(?, ?, NULL), (?, ?, NULL)")
        assert.notInclude(insert.sql, "display_name = VALUES(display_name)")
        assert.deepEqual(insert.values, [
          "relay-one",
          "instance-one",
          "relay-one",
          "instance-two",
        ])
      }).pipe(Effect.provide(databaseLayer))
    }
  )
})
