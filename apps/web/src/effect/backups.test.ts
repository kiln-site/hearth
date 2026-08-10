import { describe, expect, it } from "vite-plus/test"

import { BackupLimitError } from "@/effect/errors"
import { backupReservation, effectiveBackupLimit } from "@/effect/backups"

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
