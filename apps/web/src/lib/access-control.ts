import type { RowDataPacket } from "mysql2/promise"

import type { AuthenticatedUser } from "@/lib/auth-session"
import { databasePool } from "@/lib/database"
import { databaseTable } from "@/lib/database-config"
import type { AccessPermission, AccessRole } from "@/lib/permissions"
import { isAccessRole, roleHasPermission } from "@/lib/permissions"

interface GrantRow extends RowDataPacket {
  id: string
  relay_id: string
  resource_type: "instance" | "relay"
  resource_id: string
  role: string
}

export interface AccessGrant {
  id: string
  relayId: string
  resourceId: string
  resourceType: "instance" | "relay"
  role: AccessRole
}

export async function listUserGrants(
  userId: string,
  relayId?: string
): Promise<Array<AccessGrant>> {
  const [rows] = await databasePool.query<Array<GrantRow>>(
    `SELECT id, relay_id, resource_type, resource_id, role
       FROM ${databaseTable("access_grant")}
      WHERE user_id = ?${relayId ? " AND relay_id = ?" : ""}
      ORDER BY created_at ASC`,
    relayId ? [userId, relayId] : [userId]
  )
  return rows.flatMap((row) =>
    isAccessRole(row.role)
      ? [
          {
            id: row.id,
            relayId: row.relay_id,
            resourceId: row.resource_id,
            resourceType: row.resource_type,
            role: row.role,
          },
        ]
      : []
  )
}

export function isPlatformAdmin(user: AuthenticatedUser): boolean {
  return user.isDevelopmentBypass || user.role === "admin"
}

export async function hasRelayPermission(input: {
  user: AuthenticatedUser
  relayId: string
  permission: AccessPermission
  instanceId?: string
}): Promise<boolean> {
  if (isPlatformAdmin(input.user)) return true
  const grants = await listUserGrants(input.user.id, input.relayId)
  return grants.some((grant) => {
    if (!roleHasPermission(grant.role, input.permission)) return false
    if (grant.resourceType === "relay") return true
    return Boolean(input.instanceId && grant.resourceId === input.instanceId)
  })
}

export async function requireRelayPermission(input: {
  user: AuthenticatedUser
  relayId: string
  permission: AccessPermission
  instanceId?: string
}): Promise<void> {
  if (await hasRelayPermission(input)) return
  throw new Error("You do not have permission to perform this action")
}

export async function allowedInstanceIds(
  user: AuthenticatedUser,
  relayId: string,
  instanceIds: Array<string>
): Promise<Set<string>> {
  if (isPlatformAdmin(user)) return new Set(instanceIds)
  const grants = await listUserGrants(user.id, relayId)
  if (
    grants.some(
      (grant) =>
        grant.resourceType === "relay" &&
        roleHasPermission(grant.role, "instance.read")
    )
  ) {
    return new Set(instanceIds)
  }
  return new Set(
    grants
      .filter(
        (grant) =>
          grant.resourceType === "instance" &&
          roleHasPermission(grant.role, "instance.read")
      )
      .map((grant) => grant.resourceId)
  )
}
