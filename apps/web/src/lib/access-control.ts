import type { RowDataPacket } from "mysql2/promise"
import { Effect } from "effect"

import type { AuthenticatedUser } from "@/lib/auth-session"
import { databaseTable } from "@/lib/database-config"
import { Database } from "@/effect/database"
import { PermissionDeniedError } from "@/effect/errors"
import { runAppEffect } from "@/effect/runtime"
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
  return runAppEffect(
    "access.listUserGrants",
    listUserGrantsEffect(userId, relayId)
  )
}

export const listUserGrantsEffect = Effect.fn("access.listUserGrants")(
  function* (userId: string, relayId?: string) {
    const database = yield* Database
    const rows = yield* database.queryRows<GrantRow>(
      "access_grants",
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
)

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
  return runAppEffect(
    "access.requireRelayPermission",
    requireRelayPermissionEffect(input)
  )
}

export const requireRelayPermissionEffect = Effect.fn(
  "access.requireRelayPermission"
)(function* (input: {
  user: AuthenticatedUser
  relayId: string
  permission: AccessPermission
  instanceId?: string
}) {
  if (isPlatformAdmin(input.user)) return
  const grants = yield* listUserGrantsEffect(input.user.id, input.relayId)
  const allowed = grants.some((grant) => {
    if (!roleHasPermission(grant.role, input.permission)) return false
    if (grant.resourceType === "relay") return true
    return Boolean(input.instanceId && grant.resourceId === input.instanceId)
  })
  if (!allowed) {
    return yield* PermissionDeniedError.make({
      message: "You do not have permission to perform this action",
    })
  }
})

export async function allowedInstanceIds(
  user: AuthenticatedUser,
  relayId: string,
  instanceIds: Array<string>
): Promise<Set<string>> {
  return runAppEffect(
    "access.allowedInstanceIds",
    allowedInstanceIdsEffect(user, relayId, instanceIds)
  )
}

export const allowedInstanceIdsEffect = Effect.fn("access.allowedInstanceIds")(
  function* (
    user: AuthenticatedUser,
    relayId: string,
    instanceIds: Array<string>
  ) {
    if (isPlatformAdmin(user)) return new Set(instanceIds)
    const grants = yield* listUserGrantsEffect(user.id, relayId)
    if (
      grants.some(
        (grant) =>
          grant.resourceType === "relay" &&
          roleHasPermission(grant.role, "instance.read")
      )
    ) {
      return new Set(instanceIds)
    }
    const allowedInstanceIds = new Set<string>()
    for (const grant of grants) {
      if (
        grant.resourceType === "instance" &&
        roleHasPermission(grant.role, "instance.read")
      ) {
        allowedInstanceIds.add(grant.resourceId)
      }
    }
    return allowedInstanceIds
  }
)
