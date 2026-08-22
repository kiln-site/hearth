import { describe, expect, it } from "vite-plus/test"

import { scheduleBackupDestination } from "./schedule-backup-configuration"

describe("schedule backup configuration", () => {
  it("maps Default to Relay-local storage instead of a storage UUID", () => {
    expect(scheduleBackupDestination("default")).toEqual({
      kind: "local",
    })
  })

  it("keeps configured S3 storage available to scheduled backups", () => {
    expect(
      scheduleBackupDestination("11111111-1111-4111-8111-111111111111")
    ).toEqual({
      kind: "storage",
      storageId: "11111111-1111-4111-8111-111111111111",
    })
  })
})
