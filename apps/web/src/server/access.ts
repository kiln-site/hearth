import { createHash, randomBytes, randomUUID } from "node:crypto"

import { createServerFn } from "@tanstack/react-start"
import type { RowDataPacket } from "mysql2/promise"
import { Resend } from "resend"
import { z } from "zod"

import { AccessInvitationEmail } from "@/emails/access-invitation-email"
import {
  hasRelayPermission,
  isPlatformAdmin,
  listUserGrants,
  requireRelayPermission,
} from "@/lib/access-control"
import { databasePool } from "@/lib/database"
import { databaseTable } from "@/lib/database-config"
import { emailDeliveryConfig, kilnPublicUrl } from "@/lib/environment"
import { accessRoles } from "@/lib/permissions"
import { requireAuthenticatedUser } from "@/server/auth"

const tokenSchema = z.object({ token: z.string().min(32).max(256) })
const grantIdSchema = z.object({ id: z.uuid() })
const invitationIdSchema = z.object({ id: z.uuid() })
const invitationSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  instanceId: z.string().min(1).max(64).nullable(),
  resourceName: z.string().trim().min(1).max(160),
  role: z.enum(accessRoles),
})
const updateGrantSchema = grantIdSchema.extend({ role: z.enum(accessRoles) })

interface InvitationRow extends RowDataPacket {
  accepted_at: Date | null
  email: string
  expires_at: Date
  id: string
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
  resource_type: "instance" | "relay"
  role: (typeof accessRoles)[number]
  user_id: string
}

interface PendingInvitationRow extends RowDataPacket {
  created_at: Date
  email: string
  expires_at: Date
  id: string
  instance_id: string | null
  role: (typeof accessRoles)[number]
}

export const getAccessCapabilities = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireAuthenticatedUser()
    const relay = await defaultRelay()
    const grants =
      relay && !isPlatformAdmin(user)
        ? await listUserGrants(user.id, relay.id)
        : []
    return {
      user,
      canManageAccess:
        isPlatformAdmin(user) ||
        (relay
          ? await hasRelayPermission({
              user,
              relayId: relay.id,
              permission: "access.manage",
            })
          : false),
      isPlatformAdmin: isPlatformAdmin(user),
      grants,
    }
  }
)

export const getAccessOverview = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireAuthenticatedUser()
    const relay = await requiredDefaultRelay()
    await requireRelayPermission({
      user,
      relayId: relay.id,
      permission: "access.manage",
    })
    const [grants, invitations] = await Promise.all([
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
        `SELECT id, email, instance_id, role, expires_at, created_at
           FROM ${databaseTable("invitation")}
          WHERE relay_id = ?
            AND accepted_at IS NULL
            AND revoked_at IS NULL
            AND expires_at > CURRENT_TIMESTAMP(3)
          ORDER BY created_at DESC`,
        [relay.id]
      ),
    ])
    return {
      canManageOwners: await canManageOwners(user, relay.id),
      grants: grants[0].map((grant) => ({
        createdAt: grant.created_at.toISOString(),
        email: grant.email,
        id: grant.id,
        name: grant.name,
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
        instanceId: invitation.instance_id,
        role: invitation.role,
      })),
      relay: { id: relay.id, name: relay.name },
    }
  }
)

export const createAccessInvitation = createServerFn({ method: "POST" })
  .validator(invitationSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const relay = await requiredDefaultRelay()
    await requireRelayPermission({
      user,
      relayId: relay.id,
      permission: "access.invite",
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
          AND accepted_at IS NULL AND revoked_at IS NULL`,
      [data.email, relay.id, data.instanceId, data.instanceId]
    )
    await databasePool.execute(
      `INSERT INTO ${databaseTable("invitation")}
        (id, token_hash, email, relay_id, instance_id, role, invited_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        hashToken(token),
        data.email,
        relay.id,
        data.instanceId,
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
            scope: data.instanceId ? "instance" : "relay",
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
    const connection = await databasePool.getConnection()
    try {
      await connection.beginTransaction()
      const [rows] = await connection.query<Array<InvitationRow>>(
        `SELECT id, email, relay_id, instance_id, role, invited_by,
                expires_at, accepted_at, revoked_at
           FROM ${databaseTable("invitation")} WHERE token_hash = ? FOR UPDATE`,
        [hashToken(data.token)]
      )
      const invitation: InvitationRow | undefined = rows.at(0)
      if (!invitation || !isInvitationPending(invitation)) {
        throw new Error("This invitation is invalid or has expired")
      }
      if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
        throw new Error(
          `Sign in as ${invitation.email} to accept this invitation`
        )
      }
      const resourceType = invitation.instance_id ? "instance" : "relay"
      const resourceId = invitation.instance_id ?? invitation.relay_id
      await connection.execute(
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
      await connection.execute(
        `UPDATE ${databaseTable("invitation")} SET accepted_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [invitation.id]
      )
      await connection.commit()
      return { accepted: true }
    } catch (cause) {
      await connection.rollback()
      throw cause
    } finally {
      connection.release()
    }
  })

export const updateAccessGrant = createServerFn({ method: "POST" })
  .validator(updateGrantSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const relay = await requiredDefaultRelay()
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
  .validator(grantIdSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const relay = await requiredDefaultRelay()
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

export const revokeAccessInvitation = createServerFn({ method: "POST" })
  .validator(invitationIdSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const relay = await requiredDefaultRelay()
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

async function defaultRelay() {
  const { resolveDefaultRelay } = await import("@/lib/relay-registry")
  return resolveDefaultRelay()
}

async function requiredDefaultRelay() {
  const relay = await defaultRelay()
  if (!relay) throw new Error("No Relay is configured")
  return relay
}

async function relayById(id: string) {
  const { listPersistedRelays } = await import("@/lib/relay-registry")
  return (await listPersistedRelays()).find((relay) => relay.id === id) ?? null
}

async function readInvitation(token: string): Promise<InvitationRow | null> {
  const [rows] = await databasePool.query<Array<InvitationRow>>(
    `SELECT id, email, relay_id, instance_id, role, invited_by,
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
