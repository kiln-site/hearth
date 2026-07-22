import type { RowDataPacket } from "mysql2/promise"

import { databasePool } from "@/lib/database"
import { databaseTable } from "@/lib/database-config"
import { isAccessRole, roleHasPermission } from "@/lib/permissions"

interface UserRow extends RowDataPacket {
  banned: number | boolean | null
  id: string
  role: string | null
}

interface InstanceRow extends RowDataPacket {
  instance_id: string
}

interface GrantRow extends RowDataPacket {
  resource_id: string
  resource_type: "instance" | "relay"
  role: string
}

export interface SftpAuthorization {
  instances: ReadonlyArray<{ id: string; actions: ReadonlyArray<string> }>
  userId: string
  username: string
}

export async function resolveSftpAuthorization(
  relayId: string,
  username: string
): Promise<SftpAuthorization | null> {
  const normalizedUsername = username.trim().toLowerCase()
  if (!normalizedUsername || normalizedUsername.length > 320) return null

  const [users] = await databasePool.query<Array<UserRow>>(
    `SELECT id, role, banned
       FROM ${databaseTable("user")}
      WHERE LOWER(email) = ?
      LIMIT 1`,
    [normalizedUsername]
  )
  const user = users[0]
  if (!user || Boolean(user.banned)) return null

  const [instances] = await databasePool.query<Array<InstanceRow>>(
    `SELECT instance_id
       FROM ${databaseTable("instance")}
      WHERE relay_id = ?
      ORDER BY instance_id ASC`,
    [relayId]
  )
  if (user.role === "admin") {
    return {
      instances: instances.map((instance) => ({
        actions: sftpFileActions(true),
        id: instance.instance_id,
      })),
      userId: user.id,
      username: normalizedUsername,
    }
  }

  const [grants] = await databasePool.query<Array<GrantRow>>(
    `SELECT resource_type, resource_id, role
       FROM ${databaseTable("access_grant")}
      WHERE user_id = ? AND relay_id = ?`,
    [user.id, relayId]
  )
  const instanceIds = new Set(instances.map((instance) => instance.instance_id))
  const resolved = new Map<string, Set<string>>()
  for (const grant of grants) {
    if (!isAccessRole(grant.role)) continue
    if (!roleHasPermission(grant.role, "instance.sftp.connect")) continue
    const actions = sftpFileActions(
      roleHasPermission(grant.role, "instance.files.write")
    )
    const grantedIds =
      grant.resource_type === "relay"
        ? instanceIds
        : new Set([grant.resource_id])
    for (const instanceId of grantedIds) {
      if (!instanceIds.has(instanceId)) continue
      const existing = resolved.get(instanceId) ?? new Set<string>()
      for (const action of actions) existing.add(action)
      resolved.set(instanceId, existing)
    }
  }
  if (resolved.size === 0) return null
  return {
    instances: [...resolved]
      .map(([id, actions]) => ({ actions: [...actions].sort(), id }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    userId: user.id,
    username: normalizedUsername,
  }
}

function sftpFileActions(writable: boolean): ReadonlyArray<string> {
  return writable
    ? [
        "instance.files.list",
        "instance.files.read",
        "instance.files.create",
        "instance.files.write",
        "instance.files.delete",
        "instance.files.rename",
        "instance.files.chmod",
      ]
    : ["instance.files.list", "instance.files.read"]
}
