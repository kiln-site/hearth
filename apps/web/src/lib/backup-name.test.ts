import { describe, expect, it } from "vite-plus/test"

import { timestampedBackupName } from "@/lib/backup-name"

describe("timestamped backup names", () => {
  const timestamp = new Date("2026-08-03T04:05:06.789Z")

  it("formats manual backup names", () => {
    expect(timestampedBackupName("manual", timestamp)).toBe(
      "manual-2026.08.03-04.05.06Z"
    )
  })

  it("formats final backup names", () => {
    expect(timestampedBackupName("final", timestamp)).toBe(
      "final-2026.08.03-04.05.06Z"
    )
  })
})
