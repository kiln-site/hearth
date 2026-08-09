import { createHash, randomBytes, randomUUID } from "node:crypto"

import { createServerFn } from "@tanstack/react-start"
import { relayAuditRecordSchema, relayIdSchema } from "@workspace/contracts"
import { Effect } from "effect"
import type { RowDataPacket } from "mysql2/promise"
import { Resend } from "resend"
import { z } from "zod"

import { AccessInvitationEmail } from "@/emails/access-invitation-email"
import { Database } from "@/effect/database"
import { runAppEffect } from "@/effect/runtime"
import {
  hasRelayPermission,
  isPlatformAdmin,
  listUserGrants,
  requireRelayPermission,
} from "@/lib/access-control"
import {
  activityPermissionForAudit,
  auditInstanceId,
  auditUserId,
} from "@/lib/activity"
import { databasePool } from "@/lib/database"
import { databaseTable } from "@/lib/database-config"
import { emailDeliveryConfig, kilnPublicUrl } from "@/lib/environment"
import { accessRoles, isAccessRole, roleHasPermission } from "@/lib/permissions"
import type { PersistedRelay } from "@/lib/relay-registry"
import { listPersistedRelays } from "@/lib/relay-registry"
import { requireAuthenticatedUser } from "@/server/auth"

const tokenSchema = z.object({ token: z.string().min(32).max(256) })
const relayResourceIdSchema = z.object({
  id: z.uuid(),
  relayId: relayIdSchema,
})
const instanceScopeSchema = z.object({
  instanceId: z.string().regex(/^[a-f0-9]{40}$/u),
  relayId: relayIdSchema,
})
const instanceGrantSchema = instanceScopeSchema.extend({ id: z.uuid() })
const transferInstanceOwnershipSchema = instanceScopeSchema.extend({
  userId: z.string().min(1).max(36),
})
const invitationSchema = z
  .object({
    databaseId: z
      .string()
      .regex(/^[a-f0-9]{40}$/u)
      .nullable(),
    email: z.email().transform((value) => value.trim().toLowerCase()),
    instanceId: z.string().min(1).max(64).nullable(),
    relayId: relayIdSchema,
    resourceName: z.string().trim().min(1).max(160),
    role: z.enum(accessRoles),
  })
  .refine((value) => !(value.databaseId && value.instanceId), {
    message: "Choose one invitation scope",
  })
const updateGrantSchema = relayResourceIdSchema.extend({
  role: z.enum(accessRoles),
})

interface InvitationRow extends RowDataPacket {
  accepted_at: Date | null
  email: string
  expires_at: Date
  id: string
  database_id: string | null
  instance_id: string | null
  invited_by: string
  relay_id: string
  revoked_at: Date | null
  role: (typeof accessRoles)[number]
}

interface AccessOverviewRow extends RowDataPacket {
  created_at: Date
  email: string
  id: string
  name: string
  resource_id: string
  resource_type: "database" | "instance" | "relay"
  role: (typeof accessRoles)[number]
  user_id: string
}

interface PendingInvitationRow extends RowDataPacket {
  created_at: Date
  email: string
  expires_at: Date
  id: string
  database_id: string | null
  instance_id: string | null
  role: (typeof accessRoles)[number]
}

interface DatabaseResourceRow extends RowDataPacket {
  database_id: string
}

interface InstanceGrantRow extends RowDataPacket {
  created_at: Date
  email: string
  id: string
  role: string
  user_id: string
}

interface InstanceUserRow extends RowDataPacket {
  email: string
  id: string
}

interface InstanceOwnerRow extends RowDataPacket {
  owner_id: string | null
}

interface InstanceOwnerGrantRow extends RowDataPacket {
  user_id: string
}

export const getAccessCapabilities = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireAuthenticatedUser()
    const platformAdmin = isPlatformAdmin(user)
    const relays = (await listPersistedRelays()).filter(
      (relay) => relay.enabled
    )
    const grants = platformAdmin ? [] : await listUserGrants(user.id)
    const enabledRelayIds = new Set(relays.map((relay) => relay.id))
    return {
      user,
      canManageAccess:
        platformAdmin ||
        grants.some(
          (grant) =>
            enabledRelayIds.has(grant.relayId) &&
            grant.resourceType === "relay" &&
            grant.resourceId === grant.relayId &&
            roleHasPermission(grant.role, "access.manage")
        ),
      isPlatformAdmin: platformAdmin,
      grants,
    }
  }
)

export const getAccessOverview = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireAuthenticatedUser()
    const platformAdmin = isPlatformAdmin(user)
    const relays = (await listPersistedRelays()).filter(
      (relay) => relay.enabled
    )
    const relayAccess = await Promise.all(
      relays.map(async (relay) => ({
        relay,
        manageable:
          platformAdmin ||
          (await hasRelayPermission({
            user,
            relayId: relay.id,
            permission: "access.manage",
          })),
      }))
    )
    const manageableRelays = relayAccess.flatMap((entry) =>
      entry.manageable ? [entry.relay] : []
    )
    if (manageableRelays.length === 0) {
      throw new Error("You do not have permission to manage Relay access")
    }
    const sections = await Promise.all(
      manageableRelays.map((relay) => relayAccessOverview(user, relay))
    )
    return {
      grants: sections.flatMap((section) => section.grants),
      invitations: sections.flatMap((section) => section.invitations),
      ownerRelayIds: sections.flatMap((section) =>
        section.canManageOwners ? [section.relay.id] : []
      ),
      relays: sections.map((section) => section.relay),
    }
  }
)

export const getInstanceUsers = createServerFn({ method: "GET" })
  .validator(instanceScopeSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const relay = await requiredRelay(data.relayId)
    await requireRelayPermission({
      user,
      relayId: relay.id,
      permission: "instance.read",
      instanceId: data.instanceId,
    })

    const ownerId = await instanceOwnerId(relay, data.instanceId)
    const platformAdmin = isPlatformAdmin(user)
    const userGrants = platformAdmin
      ? []
      : await listUserGrants(user.id, relay.id)
    const canManage =
      platformAdmin ||
      ownerId === user.id ||
      userGrants.some(
        (grant) =>
          roleHasPermission(grant.role, "access.manage") &&
          (grant.resourceType === "relay" ||
            (grant.resourceType === "instance" &&
              grant.resourceId === data.instanceId))
      )
    const canOpenAccessPage =
      platformAdmin ||
      userGrants.some(
        (grant) =>
          grant.resourceType === "relay" &&
          roleHasPermission(grant.role, "access.manage")
      )

    const [grantRows, owner] = await Promise.all([
      databasePool.query<Array<InstanceGrantRow>>(
        `SELECT grant_row.id, grant_row.user_id, grant_row.role,
                grant_row.created_at, auth_user.email
           FROM ${databaseTable("access_grant")} AS grant_row
           JOIN ${databaseTable("user")} AS auth_user
             ON auth_user.id = grant_row.user_id
          WHERE grant_row.relay_id = ?
            AND grant_row.resource_type = 'instance'
            AND grant_row.resource_id = ?
          ORDER BY grant_row.created_at ASC`,
        [relay.id, data.instanceId]
      ),
      ownerId ? instanceOwnerUser(ownerId, user) : null,
    ])
    const grants = grantRows[0].flatMap((grant) =>
      isAccessRole(grant.role)
        ? [
            {
              createdAt: grant.created_at.toISOString(),
              email: grant.email,
              id: grant.id,
              role: grant.role,
              userId: grant.user_id,
            },
          ]
        : []
    )
    return {
      canManage,
      canOpenAccessPage,
      canTransferOwnership: platformAdmin || owner?.id === user.id,
      owner,
      users: grants.filter((grant) => grant.userId !== owner?.id),
    }
  })

async function relayAccessOverview(
  user: Awaited<ReturnType<typeof requireAuthenticatedUser>>,
  relay: PersistedRelay
) {
  const [grants, invitations, ownerAccess] = await Promise.all([
    databasePool.query<Array<AccessOverviewRow>>(
      `SELECT grant_row.id, grant_row.user_id, grant_row.resource_type,
              grant_row.resource_id, grant_row.role, grant_row.created_at,
              auth_user.name, auth_user.email
         FROM ${databaseTable("access_grant")} AS grant_row
         JOIN ${databaseTable("user")} AS auth_user ON auth_user.id = grant_row.user_id
        WHERE grant_row.relay_id = ?
        ORDER BY auth_user.name ASC, grant_row.created_at ASC`,
      [relay.id]
    ),
    databasePool.query<Array<PendingInvitationRow>>(
      `SELECT id, email, instance_id, database_id, role, expires_at, created_at
         FROM ${databaseTable("invitation")}
        WHERE relay_id = ?
          AND accepted_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP(3)
        ORDER BY created_at DESC`,
      [relay.id]
    ),
    canManageOwners(user, relay.id),
  ])

  return {
    canManageOwners: ownerAccess,
    grants: grants[0].map((grant) => ({
      createdAt: grant.created_at.toISOString(),
      email: grant.email,
      id: grant.id,
      name: grant.name,
      relayId: relay.id,
      relayName: relay.name,
      resourceId: grant.resource_id,
      resourceType: grant.resource_type,
      role: grant.role,
      userId: grant.user_id,
    })),
    invitations: invitations[0].map((invitation) => ({
      createdAt: invitation.created_at.toISOString(),
      email: invitation.email,
      expiresAt: invitation.expires_at.toISOString(),
      id: invitation.id,
      databaseId: invitation.database_id,
      instanceId: invitation.instance_id,
      relayId: relay.id,
      relayName: relay.name,
      role: invitation.role,
    })),
    relay: { id: relay.id, name: relay.name },
  }
}

export const createAccessInvitation = createServerFn({ method: "POST" })
  .validator(invitationSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const relay = await requiredRelay(data.relayId)
    await requireRelayPermission({
      user,
      relayId: relay.id,
      permission: "access.invite",
      databaseId: data.databaseId ?? undefined,
      instanceId: data.instanceId ?? undefined,
    })
    if (data.role === "owner" && !(await canManageOwners(user, relay.id))) {
      throw new Error(
        "Only a Relay owner or platform admin can grant the owner role"
      )
    }

    const token = randomBytes(32).toString("base64url")
    const id = randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await databasePool.execute(
      `UPDATE ${databaseTable("invitation")}
          SET revoked_at = CURRENT_TIMESTAMP(3)
        WHERE email = ? AND relay_id = ?
          AND ((instance_id IS NULL AND ? IS NULL) OR instance_id = ?)
          AND ((database_id IS NULL AND ? IS NULL) OR database_id = ?)
          AND accepted_at IS NULL AND revoked_at IS NULL`,
      [
        data.email,
        relay.id,
        data.instanceId,
        data.instanceId,
        data.databaseId,
        data.databaseId,
      ]
    )
    await databasePool.execute(
      `INSERT INTO ${databaseTable("invitation")}
        (id, token_hash, email, relay_id, instance_id, database_id, role, invited_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        hashToken(token),
        data.email,
        relay.id,
        data.instanceId,
        data.databaseId,
        data.role,
        user.id,
        expiresAt,
      ]
    )

    const inviteUrl = new URL("/invite", publicUrl())
    inviteUrl.searchParams.set("token", token)
    const delivery = emailDeliveryConfig()
    if (delivery) {
      const resend = new Resend(delivery.apiKey)
      const { error } = await resend.emails.send(
        {
          from: delivery.from,
          to: [data.email],
          subject: `You've been invited to ${data.resourceName} in Kiln`,
          react: AccessInvitationEmail({
            inviteUrl: inviteUrl.toString(),
            inviterName: user.name,
            resourceName: data.resourceName,
            role: data.role,
            scope: data.databaseId
              ? "database"
              : data.instanceId
                ? "instance"
                : "relay",
          }),
        },
        { idempotencyKey: `access-invitation/${id}` }
      )
      if (error) {
        await databasePool.execute(
          `UPDATE ${databaseTable("invitation")} SET revoked_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
          [id]
        )
        throw new Error(error.message || "Could not send invitation email")
      }
    } else {
      console.info(`[Kiln access] Invitation for ${data.email}: ${inviteUrl}`)
    }
    return {
      expiresAt: expiresAt.toISOString(),
      id,
      inviteUrl: delivery ? null : inviteUrl.toString(),
    }
  })

export const getInvitationPreview = createServerFn({ method: "GET" })
  .validator(tokenSchema)
  .handler(async ({ data }) => {
    const invitation = await readInvitation(data.token)
    if (!invitation || !isInvitationPending(invitation)) return null
    const relay = await relayById(invitation.relay_id)
    return {
      email: invitation.email,
      databaseId: invitation.database_id,
      expiresAt: invitation.expires_at.toISOString(),
      instanceId: invitation.instance_id,
      relayName: relay?.name ?? "Kiln Relay",
      role: invitation.role,
    }
  })

export const acceptAccessInvitation = createServerFn({ method: "POST" })
  .validator(tokenSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    if (!user.emailVerified)
      throw new Error("Verify your email before accepting")
    return runAppEffect(
      "access.invitation.accept",
      Effect.gen(function* () {
        const database = yield* Database
        return yield* database.transaction("access.invitation.accept", (tx) =>
          Effect.gen(function* () {
            const rows = yield* tx.queryRows<InvitationRow>(
              `SELECT id, email, relay_id, instance_id, database_id, role, invited_by,
                expires_at, accepted_at, revoked_at
           FROM ${databaseTable("invitation")} WHERE token_hash = ? FOR UPDATE`,
              [hashToken(data.token)]
            )
            const invitation = rows.at(0)
            if (!invitation || !isInvitationPending(invitation)) {
              return yield* Effect.fail(
                new Error("This invitation is invalid or has expired")
              )
            }
            if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
              return yield* Effect.fail(
                new Error(
                  `Sign in as ${invitation.email} to accept this invitation`
                )
              )
            }
            if (invitation.database_id) {
              const databases = yield* tx.queryRows<DatabaseResourceRow>(
                `SELECT database_id FROM ${databaseTable("database")}
                  WHERE relay_id = ? AND database_id = ? FOR UPDATE`,
                [invitation.relay_id, invitation.database_id]
              )
              if (!databases.at(0)) {
                return yield* Effect.fail(
                  new Error("This database no longer exists")
                )
              }
            }
            const resourceType = invitation.database_id
              ? "database"
              : invitation.instance_id
                ? "instance"
                : "relay"
            const resourceId =
              invitation.database_id ??
              invitation.instance_id ??
              invitation.relay_id
            yield* tx.execute(
              `INSERT INTO ${databaseTable("access_grant")}
          (id, user_id, relay_id, resource_type, resource_id, role, granted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE role = VALUES(role), granted_by = VALUES(granted_by)`,
              [
                randomUUID(),
                user.id,
                invitation.relay_id,
                resourceType,
                resourceId,
                invitation.role,
                invitation.invited_by,
              ]
            )
            yield* tx.execute(
              `UPDATE ${databaseTable("invitation")} SET accepted_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
              [invitation.id]
            )
            return { accepted: true }
          })
        )
      })
    )
  })

export const updateAccessGrant = createServerFn({ method: "POST" })
  .validator(updateGrantSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const relay = await requiredRelay(data.relayId)
    await requireRelayPermission({
      user,
      relayId: relay.id,
      permission: "access.manage",
    })
    const currentRole = await grantRole(data.id, relay.id)
    if (
      (currentRole === "owner" || data.role === "owner") &&
      !(await canManageOwners(user, relay.id))
    ) {
      throw new Error(
        "Only a Relay owner or platform admin can change owner access"
      )
    }
    await databasePool.execute(
      `UPDATE ${databaseTable("access_grant")} SET role = ? WHERE id = ? AND relay_id = ?`,
      [data.role, data.id, relay.id]
    )
    return { updated: true }
  })

export const removeAccessGrant = createServerFn({ method: "POST" })
  .validator(relayResourceIdSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const relay = await requiredRelay(data.relayId)
    await requireRelayPermission({
      user,
      relayId: relay.id,
      permission: "access.manage",
    })
    if (
      (await grantRole(data.id, relay.id)) === "owner" &&
      !(await canManageOwners(user, relay.id))
    ) {
      throw new Error(
        "Only a Relay owner or platform admin can remove owner access"
      )
    }
    await databasePool.execute(
      `DELETE FROM ${databaseTable("access_grant")} WHERE id = ? AND relay_id = ?`,
      [data.id, relay.id]
    )
    return { removed: true }
  })

export const removeInstanceAccessGrant = createServerFn({ method: "POST" })
  .validator(instanceGrantSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const relay = await requiredRelay(data.relayId)
    const ownerId = await instanceOwnerId(relay, data.instanceId)
    if (!isPlatformAdmin(user) && ownerId !== user.id) {
      await requireRelayPermission({
        user,
        relayId: relay.id,
        permission: "access.manage",
        instanceId: data.instanceId,
      })
    }
    await databasePool.execute(
      `DELETE FROM ${databaseTable("access_grant")}
        WHERE id = ? AND relay_id = ?
          AND resource_type = 'instance' AND resource_id = ?`,
      [data.id, relay.id, data.instanceId]
    )
    return { removed: true }
  })

export const transferInstanceOwnership = createServerFn({ method: "POST" })
  .validator(transferInstanceOwnershipSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const relay = await requiredRelay(data.relayId)
    await instanceOwnerId(relay, data.instanceId)
    const platformAdmin = isPlatformAdmin(user)

    return runAppEffect(
      "access.instance.transferOwnership",
      Effect.gen(function* () {
        const database = yield* Database
        return yield* database.transaction(
          "access.instance.transferOwnership",
          (transaction) =>
            Effect.gen(function* () {
              const ownerRows = yield* transaction.queryRows<InstanceOwnerRow>(
                `SELECT owner_id FROM ${databaseTable("instance")}
                    WHERE relay_id = ? AND instance_id = ? LIMIT 1 FOR UPDATE`,
                [relay.id, data.instanceId]
              )
              const ownerId = ownerRows.at(0)?.owner_id ?? null
              if (!platformAdmin && ownerId !== user.id) {
                return yield* Effect.fail(
                  new Error("Only the server owner can transfer ownership")
                )
              }
              if (ownerId === data.userId) {
                return yield* Effect.fail(
                  new Error("This user already owns the server")
                )
              }

              const targetGrants =
                yield* transaction.queryRows<InstanceOwnerGrantRow>(
                  `SELECT user_id FROM ${databaseTable("access_grant")}
                  WHERE user_id = ? AND relay_id = ?
                    AND resource_type = 'instance' AND resource_id = ?
                  LIMIT 1 FOR UPDATE`,
                  [data.userId, relay.id, data.instanceId]
                )
              if (!targetGrants.at(0)) {
                return yield* Effect.fail(
                  new Error(
                    "Give this user direct server access before transferring ownership"
                  )
                )
              }

              yield* transaction.execute(
                `INSERT INTO ${databaseTable("instance")}
                   (relay_id, instance_id, display_name, owner_id)
                 VALUES (?, ?, NULL, ?)
                 ON DUPLICATE KEY UPDATE owner_id = VALUES(owner_id)`,
                [relay.id, data.instanceId, data.userId]
              )
              yield* transaction.execute(
                `UPDATE ${databaseTable("access_grant")}
                    SET role = 'admin'
                  WHERE relay_id = ? AND resource_type = 'instance'
                    AND resource_id = ? AND role = 'owner' AND user_id <> ?`,
                [relay.id, data.instanceId, data.userId]
              )
              yield* transaction.execute(
                `UPDATE ${databaseTable("access_grant")}
                    SET role = 'owner', granted_by = ?
                  WHERE user_id = ? AND relay_id = ?
                    AND resource_type = 'instance' AND resource_id = ?`,
                [user.id, data.userId, relay.id, data.instanceId]
              )
              return { transferred: true }
            })
        )
      })
    )
  })

export const revokeAccessInvitation = createServerFn({ method: "POST" })
  .validator(relayResourceIdSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const relay = await requiredRelay(data.relayId)
    await requireRelayPermission({
      user,
      relayId: relay.id,
      permission: "access.manage",
    })
    const [invitationRows] = await databasePool.query<
      Array<{ role: string } & RowDataPacket>
    >(
      `SELECT role FROM ${databaseTable("invitation")} WHERE id = ? AND relay_id = ? LIMIT 1`,
      [data.id, relay.id]
    )
    if (
      invitationRows[0]?.role === "owner" &&
      !(await canManageOwners(user, relay.id))
    ) {
      throw new Error(
        "Only a Relay owner or platform admin can revoke an owner invitation"
      )
    }
    await databasePool.execute(
      `UPDATE ${databaseTable("invitation")} SET revoked_at = CURRENT_TIMESTAMP(3)
        WHERE id = ? AND relay_id = ? AND accepted_at IS NULL`,
      [data.id, relay.id]
    )
    return { revoked: true }
  })

async function requiredRelay(relayId: string) {
  const relay = await relayById(relayId)
  if (!relay?.enabled) throw new Error("Relay not found")
  return relay
}

async function relayById(id: string) {
  return (await listPersistedRelays()).find((relay) => relay.id === id) ?? null
}

async function readInvitation(token: string): Promise<InvitationRow | null> {
  const [rows] = await databasePool.query<Array<InvitationRow>>(
    `SELECT id, email, relay_id, instance_id, database_id, role, invited_by,
            expires_at, accepted_at, revoked_at
       FROM ${databaseTable("invitation")} WHERE token_hash = ? LIMIT 1`,
    [hashToken(token)]
  )
  return rows[0] ?? null
}

function isInvitationPending(invitation: InvitationRow): boolean {
  return (
    !invitation.accepted_at &&
    !invitation.revoked_at &&
    invitation.expires_at.getTime() > Date.now()
  )
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

function publicUrl(): string {
  return kilnPublicUrl().origin
}

async function canManageOwners(
  user: Awaited<ReturnType<typeof requireAuthenticatedUser>>,
  relayId: string
): Promise<boolean> {
  if (isPlatformAdmin(user)) return true
  return (await listUserGrants(user.id, relayId)).some(
    (grant) => grant.resourceType === "relay" && grant.role === "owner"
  )
}

async function grantRole(id: string, relayId: string): Promise<string | null> {
  const [rows] = await databasePool.query<
    Array<{ role: string } & RowDataPacket>
  >(
    `SELECT role FROM ${databaseTable("access_grant")} WHERE id = ? AND relay_id = ? LIMIT 1`,
    [id, relayId]
  )
  return rows[0]?.role ?? null
}

async function instanceOwnerId(
  relay: PersistedRelay,
  instanceId: string
): Promise<string | null> {
  const [persistedRows] = await databasePool.query<Array<InstanceOwnerRow>>(
    `SELECT owner_id FROM ${databaseTable("instance")}
      WHERE relay_id = ? AND instance_id = ? LIMIT 1`,
    [relay.id, instanceId]
  )
  const persistedOwnerId = persistedRows[0]?.owner_id
  if (persistedOwnerId) return persistedOwnerId

  const initialOwnerId =
    (await instanceInitialOwnerId(relay, instanceId)) ??
    (await instanceOwnerGrantId(relay.id, instanceId))
  if (!initialOwnerId) return null

  await databasePool.execute(
    `INSERT INTO ${databaseTable("instance")}
       (relay_id, instance_id, display_name, owner_id)
     VALUES (?, ?, NULL, ?)
     ON DUPLICATE KEY UPDATE owner_id = COALESCE(owner_id, VALUES(owner_id))`,
    [relay.id, instanceId, initialOwnerId]
  )
  const [resolvedRows] = await databasePool.query<Array<InstanceOwnerRow>>(
    `SELECT owner_id FROM ${databaseTable("instance")}
      WHERE relay_id = ? AND instance_id = ? LIMIT 1`,
    [relay.id, instanceId]
  )
  return resolvedRows[0]?.owner_id ?? initialOwnerId
}

async function instanceInitialOwnerId(
  relay: PersistedRelay,
  instanceId: string
): Promise<string | null> {
  try {
    const { relayRpc } = await import("@/lib/relay-connection")
    const records = z.array(relayAuditRecordSchema).parse(
      await relayRpc(relay, "relay.audit.list", {
        instanceIds: [instanceId],
        limit: 2_000,
      })
    )
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index]
      if (
        record &&
        auditInstanceId(record) === instanceId &&
        activityPermissionForAudit(record) === "instance.create"
      ) {
        return auditUserId(record)
      }
    }
  } catch {
    return null
  }
  return null
}

async function instanceOwnerGrantId(
  relayId: string,
  instanceId: string
): Promise<string | null> {
  const [rows] = await databasePool.query<Array<InstanceOwnerGrantRow>>(
    `SELECT user_id FROM ${databaseTable("access_grant")}
      WHERE relay_id = ? AND resource_type = 'instance'
        AND resource_id = ? AND role = 'owner'
      ORDER BY created_at ASC LIMIT 1`,
    [relayId, instanceId]
  )
  return rows[0]?.user_id ?? null
}

async function instanceOwnerUser(
  ownerId: string,
  currentUser: Awaited<ReturnType<typeof requireAuthenticatedUser>>
) {
  if (ownerId === currentUser.id) {
    return { email: currentUser.email, id: currentUser.id }
  }
  const [rows] = await databasePool.query<Array<InstanceUserRow>>(
    `SELECT id, email FROM ${databaseTable("user")} WHERE id = ? LIMIT 1`,
    [ownerId]
  )
  const owner = rows[0]
  return owner
    ? { email: owner.email, id: owner.id }
    : { email: "Former user", id: ownerId }
}
