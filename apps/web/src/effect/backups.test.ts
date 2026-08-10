import { describe, expect, it } from "vite-plus/test"

import { BackupLimitError } from "@/effect/errors"
import {
  backupReservation,
  effectiveBackupLimit,
  shouldApplyRelayBackupTaskSnapshot,
} from "@/effect/backups"

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
