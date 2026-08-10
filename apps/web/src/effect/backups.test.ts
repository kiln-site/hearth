import { describe, expect, it } from "vite-plus/test"
import { Effect, Layer } from "effect"
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"

import { Database } from "@/effect/database"
import { BackupLimitError } from "@/effect/errors"
import {
  backupReservation,
  effectiveBackupLimit,
  reserveInstanceBackupEffect,
  shouldApplyRelayBackupTaskSnapshot,
} from "@/effect/backups"

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

describe("backup limits", () => {
  it("uses the stricter user or platform limit", () => {
    expect(effectiveBackupLimit(null, null)).toBeNull()
    expect(effectiveBackupLimit(10, null)).toBe(10)
    expect(effectiveBackupLimit(null, 8)).toBe(8)
    expect(effectiveBackupLimit(10, 8)).toBe(8)
  })

  it("reserves remaining bytes and rejects exhausted limits", () => {
    expect(
      backupReservation({
        quantityLimit: 5,
        quantityUsed: 2,
        requestedMaxBytes: 800,
        sizeLimit: 1_000,
        sizeUsed: 400,
      })
    ).toEqual({ maxBytes: 600 })
    expect(() =>
      backupReservation({
        quantityLimit: 2,
        quantityUsed: 2,
        requestedMaxBytes: null,
        sizeLimit: null,
        sizeUsed: 0,
      })
    ).toThrow(BackupLimitError)
    expect(() =>
      backupReservation({
        quantityLimit: null,
        quantityUsed: 0,
        requestedMaxBytes: null,
        sizeLimit: 1_000,
        sizeUsed: 1_000,
      })
    ).toThrow(BackupLimitError)
  })

  it("keeps deleting backups in quantity and size usage", async () => {
    const queries: Array<string> = []
    const databaseLayer = Layer.succeed(Database)({
      execute: () => Effect.die("Unexpected standalone database write"),
      queryRows: () => Effect.die("Unexpected standalone database query"),
      transaction: (_operation, run) =>
        run({
          execute: () => Effect.succeed(emptyResult),
          queryRows: <TRow extends RowDataPacket>(sql: string) =>
            Effect.sync(() => {
              queries.push(sql)
              const rows = sql.includes("backup_policy")
                ? [
                    {
                      admin_quantity_limit: null,
                      admin_size_limit_bytes: null,
                      exclude_patterns: [],
                      quantity_limit: 2,
                      size_limit_bytes: 2_048,
                      storage_id: null,
                    },
                  ]
                : [{ quantity_used: 1, size_used: 1_024 }]
              return rows as unknown as ReadonlyArray<TRow>
            }),
        }),
    })

    await Effect.runPromise(
      reserveInstanceBackupEffect({
        backupId: "backup-one",
        createdBy: "user-one",
        name: "Backup one",
        relayId: "relay-one",
        requestedMaxBytes: null,
        targetId: "instance-one",
        taskId: "task-one",
      }).pipe(Effect.provide(databaseLayer))
    )

    const usageQuery = queries.find((sql) => sql.includes("SELECT COUNT(*)"))
    expect(usageQuery).toContain(
      "backup.status IN ('queued', 'running', 'available', 'deleting')"
    )
    expect(usageQuery).toContain("backup.status IN ('available', 'deleting')")
  })
})

describe("backup reconciliation", () => {
  it("rejects stale Relay snapshots after a task has completed", () => {
    const completed = {
      bytesCompleted: 256,
      relayUpdatedAt: 300,
      status: "succeeded" as const,
    }

    expect(
      shouldApplyRelayBackupTaskSnapshot(completed, {
        bytesCompleted: 128,
        status: "running",
        updatedAt: 200,
      })
    ).toBe(false)
    expect(
      shouldApplyRelayBackupTaskSnapshot(completed, {
        bytesCompleted: 0,
        status: "queued",
        updatedAt: 100,
      })
    ).toBe(false)
    expect(
      shouldApplyRelayBackupTaskSnapshot(
        { ...completed, relayUpdatedAt: null },
        { bytesCompleted: 128, status: "running", updatedAt: 400 }
      )
    ).toBe(false)
  })

  it("allows newer snapshots and same-millisecond forward progress", () => {
    expect(
      shouldApplyRelayBackupTaskSnapshot(
        { bytesCompleted: 64, relayUpdatedAt: 100, status: "running" },
        { bytesCompleted: 128, status: "running", updatedAt: 200 }
      )
    ).toBe(true)
    expect(
      shouldApplyRelayBackupTaskSnapshot(
        { bytesCompleted: 0, relayUpdatedAt: 100, status: "running" },
        { bytesCompleted: 256, status: "succeeded", updatedAt: 100 }
      )
    ).toBe(true)
    expect(
      shouldApplyRelayBackupTaskSnapshot(
        { bytesCompleted: 256, relayUpdatedAt: 100, status: "succeeded" },
        { bytesCompleted: 128, status: "running", updatedAt: 100 }
      )
    ).toBe(false)
    expect(
      shouldApplyRelayBackupTaskSnapshot(
        { bytesCompleted: 64, relayUpdatedAt: 100, status: "running" },
        { bytesCompleted: 128, status: "running", updatedAt: 100 }
      )
    ).toBe(true)
  })
})
