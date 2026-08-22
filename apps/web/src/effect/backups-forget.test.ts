import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import type { ResultSetHeader } from "mysql2/promise"
import { vi } from "vite-plus/test"

vi.hoisted(() => {
  process.env.DB_HOST ??= "127.0.0.1"
  process.env.DB_NAME ??= "test"
  process.env.DB_PASSWORD ??= "test"
  process.env.DB_USERNAME ??= "test"
})

import { Database } from "@/effect/database"
import { forgetBackupEffect, forgetRelayBackupsEffect } from "@/effect/backups"

const removedResult: ResultSetHeader = {
  affectedRows: 1,
  changedRows: 0,
  constructor: { name: "ResultSetHeader" },
  fieldCount: 0,
  info: "",
  insertId: 0,
  serverStatus: 0,
  warningStatus: 0,
}

describe("backup forgetting", () => {
  it.effect("forgets one backup without reserving Relay deletion work", () => {
    const statements: Array<{ sql: string; values: ReadonlyArray<unknown> }> =
      []

    return Effect.gen(function* () {
      const forgotten = yield* forgetBackupEffect("backup-one")

      assert.isTrue(forgotten)
      assert.deepEqual(
        statements.map(({ sql }) => deletedTable(sql)),
        [
          "kiln_backup_download_share",
          "kiln_backup_final_database_delete",
          "kiln_backup_final_delete",
          "kiln_backup",
        ]
      )
      assert.deepEqual(
        statements.map(({ values }) => values),
        Array.from({ length: 4 }, () => ["backup-one"])
      )
    }).pipe(Effect.provide(databaseLayer(statements)))
  })

  it.effect("forgets all Relay backup state without deleting artifacts", () => {
    const statements: Array<{ sql: string; values: ReadonlyArray<unknown> }> =
      []

    return Effect.gen(function* () {
      const forgotten = yield* forgetRelayBackupsEffect("relay-one")

      assert.strictEqual(forgotten, 1)
      assert.deepEqual(
        statements.map(({ sql }) => deletedTable(sql)),
        [
          "kiln_backup_download_share",
          "kiln_backup_final_database_delete",
          "kiln_backup_final_delete",
          "kiln_backup",
          "kiln_backup_policy",
          "kiln_backup_repository",
        ]
      )
      assert.deepEqual(
        statements.map(({ values }) => values),
        Array.from({ length: 6 }, () => ["relay-one"])
      )
      assert.notInclude(
        statements.map(({ sql }) => sql).join("\n"),
        "backup_task"
      )
    }).pipe(Effect.provide(databaseLayer(statements)))
  })
})

function databaseLayer(
  statements: Array<{ sql: string; values: ReadonlyArray<unknown> }>
) {
  return Layer.succeed(Database)({
    execute: () => Effect.die("Unexpected standalone database write"),
    queryRows: () => Effect.die("Unexpected standalone database query"),
    transaction: (_operation, run) =>
      run({
        execute: (sql, values) =>
          Effect.sync(() => {
            statements.push({ sql, values: values ?? [] })
            return removedResult
          }),
        queryRows: () => Effect.die("Unexpected transaction query"),
      }),
  })
}

function deletedTable(sql: string): string {
  return /DELETE FROM\s+`?(kiln_[a-z_]+)`?/.exec(sql)?.[1] ?? "unknown"
}
