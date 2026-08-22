import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"
import { vi } from "vite-plus/test"

vi.hoisted(() => {
  process.env.DB_HOST ??= "127.0.0.1"
  process.env.DB_NAME ??= "test"
  process.env.DB_PASSWORD ??= "test"
  process.env.DB_USERNAME ??= "test"
})

import { Database, type DatabaseTransaction } from "@/effect/database"
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
    const queries: Array<{ sql: string; values: ReadonlyArray<unknown> }> = []

    return Effect.gen(function* () {
      const forgotten = yield* forgetBackupEffect("backup-one")

      assert.strictEqual(forgotten, "forgotten")
      assert.deepEqual(
        statements.map(({ sql }) => deletedTable(sql)),
        [
          "kiln_backup_download_share",
          "kiln_backup_final_database_delete",
          "kiln_backup_final_delete",
          "kiln_backup",
          "kiln_backup_repository",
          "kiln_backup_policy",
        ]
      )
      assert.deepEqual(
        statements.map(({ values }) => values),
        [
          ["backup-one"],
          ["backup-one"],
          ["backup-one"],
          ["backup-one"],
          ["repository-one", "repository-one"],
          [
            "relay-one",
            "instance",
            "instance-one",
            "relay-one",
            "instance",
            "instance-one",
          ],
        ]
      )
      assert.lengthOf(queries, 2)
      assert.include(queries[0]?.sql ?? "", "FOR UPDATE")
      assert.deepEqual(queries[0]?.values, ["backup-one"])
      assert.include(queries[1]?.sql ?? "", "kiln_relay")
      assert.include(queries[1]?.sql ?? "", "FOR UPDATE")
      assert.deepEqual(queries[1]?.values, ["relay-one"])
      const cleanupSql = statements.slice(-2).map(({ sql }) => sql)
      assert.isTrue(cleanupSql.every((sql) => sql.includes("NOT EXISTS")))
      assert.notInclude(
        statements.map(({ sql }) => sql).join("\n"),
        "backup_task"
      )
    }).pipe(
      Effect.provide(
        databaseLayer(statements, queries, [
          {
            relay_id: "relay-one",
            repository_id: "repository-one",
            target_id: "instance-one",
            target_kind: "instance",
          },
        ])
      )
    )
  })

  it.effect("does not remove metadata when the backup is missing", () => {
    const statements: Array<{ sql: string; values: ReadonlyArray<unknown> }> =
      []

    return Effect.gen(function* () {
      const forgotten = yield* forgetBackupEffect("missing-backup")

      assert.strictEqual(forgotten, "not_found")
      assert.isEmpty(statements)
    }).pipe(Effect.provide(databaseLayer(statements)))
  })

  it.effect("rejects forget when the Relay is present under lock", () => {
    const statements: Array<{ sql: string; values: ReadonlyArray<unknown> }> =
      []
    const queries: Array<{ sql: string; values: ReadonlyArray<unknown> }> = []

    return Effect.gen(function* () {
      const forgotten = yield* forgetBackupEffect("backup-one")

      assert.strictEqual(forgotten, "relay_present")
      assert.isEmpty(statements)
      assert.lengthOf(queries, 2)
      assert.include(queries[1]?.sql ?? "", "kiln_relay")
      assert.include(queries[1]?.sql ?? "", "FOR UPDATE")
    }).pipe(
      Effect.provide(
        databaseLayer(
          statements,
          queries,
          [
            {
              relay_id: "relay-one",
              repository_id: "repository-one",
              target_id: "instance-one",
              target_kind: "instance",
            },
          ],
          [{ id: "relay-one" }]
        )
      )
    )
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
  statements: Array<{ sql: string; values: ReadonlyArray<unknown> }>,
  queries: Array<{ sql: string; values: ReadonlyArray<unknown> }> = [],
  backupRows: ReadonlyArray<{
    relay_id: string
    repository_id: string | null
    target_id: string
    target_kind: "database" | "instance" | "platform"
  }> = [],
  relayRows: ReadonlyArray<{ id: string }> = []
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
        queryRows: <TRow extends RowDataPacket>(
          sql: string,
          values?: Parameters<DatabaseTransaction["queryRows"]>[1]
        ) =>
          Effect.sync(() => {
            queries.push({ sql, values: values ?? [] })
            const rows = sql.includes("kiln_relay") ? relayRows : backupRows
            return [...rows] as unknown as ReadonlyArray<TRow>
          }),
      }),
  })
}

function deletedTable(sql: string): string {
  return /DELETE FROM\s+`?(kiln_[a-z_]+)`?/.exec(sql)?.[1] ?? "unknown"
}
