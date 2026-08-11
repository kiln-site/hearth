import type { BackupCatalogRecord } from "@/effect/backups"
import type { AccessGrant } from "@/lib/access-control"
import { isPlatformAdmin } from "@/lib/access-control"
import type { AuthenticatedUser } from "@/lib/auth-session"
import type { AccessPermission } from "@/lib/permissions"
import { roleHasPermission } from "@/lib/permissions"

export function hasBackupPermission(
  user: AuthenticatedUser,
  grants: ReadonlyArray<AccessGrant>,
  backup: BackupCatalogRecord,
  permission: AccessPermission
): boolean {
  if (isPlatformAdmin(user)) return true
  if (
    (permission === "backup.read" || permission === "backup.download") &&
    backup.createdBy === user.id
  ) {
    return true
  }
  return grants.some(
    (grant) =>
      grant.relayId === backup.relayId &&
      roleHasPermission(grant.role, permission) &&
      (grant.resourceType === "relay" ||
        (backup.targetKind === "instance" &&
          grant.resourceType === "instance" &&
          grant.resourceId === backup.targetId) ||
        (backup.targetKind === "database" &&
          grant.resourceType === "database" &&
          grant.resourceId === backup.targetId))
  )
}
