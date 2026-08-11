import { describe, expect, it } from "vite-plus/test"

import type { BackupCatalogRecord } from "@/effect/backups"
import type { AccessGrant } from "@/lib/access-control"
import type { AuthenticatedUser } from "@/lib/auth-session"
import { hasBackupPermission } from "@/lib/backup-access"

const user: AuthenticatedUser = {
  email: "creator@example.com",
  emailVerified: true,
  id: "creator",
  isDevelopmentBypass: false,
  name: "Creator",
  role: "user",
  twoFactorEnabled: false,
}

const backup: BackupCatalogRecord = {
  artifactKind: "archive",
  backupMode: "full",
  bytes: 1,
  checksumSha256: "0".repeat(64),
  completedAt: "2026-08-10T00:00:00.000Z",
  createdAt: "2026-08-10T00:00:00.000Z",
  createdBy: user.id,
  filename: "backup.zip",
  id: "backup-one",
  name: "Backup one",
  objectKey: null,
  reason: "manual",
  relayId: "relay-one",
  status: "available",
  storageId: null,
  targetId: "instance-one",
  targetKind: "instance",
  taskError: null,
  taskId: "task-one",
  taskStatus: "succeeded",
  warnings: [],
}

describe("backup access", () => {
  it("keeps creator download access without granting restore or delete", () => {
    expect(hasBackupPermission(user, [], backup, "backup.read")).toBe(true)
    expect(hasBackupPermission(user, [], backup, "backup.download")).toBe(true)
    expect(hasBackupPermission(user, [], backup, "backup.restore")).toBe(false)
    expect(hasBackupPermission(user, [], backup, "backup.delete")).toBe(false)
  })

  it("uses current resource grants for mutating backup actions", () => {
    const grants: Array<AccessGrant> = [
      {
        id: "grant-one",
        relayId: backup.relayId,
        resourceId: backup.targetId,
        resourceType: "instance",
        role: "operator",
      },
    ]

    expect(hasBackupPermission(user, grants, backup, "backup.restore")).toBe(
      true
    )
    expect(hasBackupPermission(user, grants, backup, "backup.delete")).toBe(
      true
    )
  })
})
