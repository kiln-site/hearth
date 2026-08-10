import { randomUUID } from "node:crypto"

import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import { relayIdSchema, relaySnapshotSchema } from "@workspace/contracts"

import {
  listBackupCatalogEffect,
  reserveBackupDeleteEffect,
  reserveInstanceBackupEffect,
  updateBackupExcludesEffect,
  updateBackupLimitsEffect,
  type BackupCatalogRecord,
} from "@/effect/backups"
import {
  loadBackupStorageCredentialEffect,
  loadBackupStorageEffect,
} from "@/effect/backup-storage"
import { runAppEffect } from "@/effect/runtime"
import {
  hasPlatformPermission,
  isPlatformAdmin,
  listUserGrants,
  requireRelayPermission,
  type AccessGrant,
} from "@/lib/access-control"
import type { AuthenticatedUser } from "@/lib/auth-session"
import type { AccessPermission } from "@/lib/permissions"
import { roleHasPermission } from "@/lib/permissions"
import { relayRpc } from "@/lib/relay-connection"
import { signS3BackupDownload } from "@/lib/backup-storage-s3"
import {
  dispatchBackupTask,
  reconcileRelayBackups,
} from "@/lib/backup-reconciliation"
import { listPersistedRelays, type PersistedRelay } from "@/lib/relay-registry"
import { requireAuthenticatedUser } from "@/server/auth"

const instanceBackupInputSchema = z.strictObject({
  instanceId: z.string().min(1).max(120),
  maxBytes: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable()
    .optional(),
  name: z.string().trim().min(1).max(120),
  relayId: relayIdSchema,
  storageId: z.uuid().nullable().optional(),
})

const backupIdInputSchema = z.strictObject({ backupId: z.uuid() })

const backupLimitsInputSchema = z.strictObject({
  instanceId: z.string().min(1).max(120),
  quantityLimit: z.number().int().nonnegative().max(1_000_000).nullable(),
  relayId: relayIdSchema,
  scope: z.enum(["platform", "user"]),
  sizeLimitBytes: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable(),
})

const backupExcludesInputSchema = z.strictObject({
  exclude: z.array(z.string().trim().min(1).max(1_024)).max(1_000),
  instanceId: z.string().min(1).max(120),
  relayId: relayIdSchema,
})

export const createInstanceBackup = createServerFn({ method: "POST" })
  .validator(instanceBackupInputSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const relay = await requireBackupRelay(data.relayId)
    await requireRelayPermission({
      instanceId: data.instanceId,
      permission: "backup.create",
      relayId: relay.id,
      user,
    })
    const snapshot = relaySnapshotSchema.parse(
      await relayRpc(relay, "relay.snapshot", {}, 15_000, user.id)
    )
    if (
      !snapshot.instances.some((instance) => instance.id === data.instanceId)
    ) {
      throw new Error("Server not found on this Relay")
    }
    if (data.storageId) {
      const storage = await runAppEffect(
        "backups.loadSelectedStorage",
        loadBackupStorageEffect(data.storageId)
      )
      if (
        !storage ||
        !storage.enabled ||
        (storage.ownerUserId !== null && storage.ownerUserId !== user.id)
      ) {
        throw new Error("Backup destination is unavailable")
      }
    }

    const input = await runAppEffect(
      "backups.reserve",
      reserveInstanceBackupEffect({
        backupId: randomUUID(),
        createdBy: user.id,
        name: data.name,
        relayId: relay.id,
        requestedMaxBytes: data.maxBytes ?? null,
        ...(data.storageId === undefined ? {} : { storageId: data.storageId }),
        targetId: data.instanceId,
        taskId: randomUUID(),
      })
    )
    let relayAccepted = true
    const dispatched = await Promise.allSettled([
      dispatchBackupTask(relay, input, user.id),
    ])
    if (dispatched[0]?.status === "rejected") relayAccepted = false
    const backup = (
      await runAppEffect("backups.listAfterCreate", listBackupCatalogEffect())
    ).find((candidate) => candidate.id === input.backupId)
    if (!backup) throw new Error("Backup catalog record was not created")
    return { backup, relayAccepted }
  })

export const getBackups = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireAuthenticatedUser()
    const relays = (await listPersistedRelays()).filter(
      (relay) => relay.enabled
    )
    const grants = isPlatformAdmin(user) ? [] : await listUserGrants(user.id)
    const catalog = await runAppEffect(
      "backups.listForReconcile",
      listBackupCatalogEffect()
    )
    const visibleRelayIds = new Set(
      catalog
        .filter((backup) =>
          hasBackupPermission(user, grants, backup, "backup.read")
        )
        .map((backup) => backup.relayId)
    )
    await Promise.allSettled(
      relays
        .filter((relay) => visibleRelayIds.has(relay.id))
        .map((relay) => reconcileRelayBackups(relay, user.id))
    )
    const reconciled = await runAppEffect(
      "backups.listReconciled",
      listBackupCatalogEffect()
    )
    return reconciled
      .filter((backup) =>
        hasBackupPermission(user, grants, backup, "backup.read")
      )
      .map(({ objectKey: _, ...backup }) => backup)
  }
)

export const deleteBackup = createServerFn({ method: "POST" })
  .validator(backupIdInputSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const catalog = await runAppEffect(
      "backups.listForDelete",
      listBackupCatalogEffect()
    )
    const backup = catalog.find((candidate) => candidate.id === data.backupId)
    if (!backup) throw new Error("Backup not found")
    const grants = isPlatformAdmin(user) ? [] : await listUserGrants(user.id)
    if (!hasBackupPermission(user, grants, backup, "backup.delete")) {
      throw new Error("You do not have permission to delete this backup")
    }
    const relay = await requireBackupRelay(backup.relayId)
    const input = await runAppEffect(
      "backups.reserveDelete",
      reserveBackupDeleteEffect({
        backupId: backup.id,
        requestedBy: user.id,
        taskId: randomUUID(),
      })
    )
    const dispatched = await Promise.allSettled([
      dispatchBackupTask(relay, input, user.id),
    ])
    return { relayAccepted: dispatched[0]?.status === "fulfilled" }
  })

export const getBackupDownloadUrl = createServerFn({ method: "POST" })
  .validator(backupIdInputSchema)
  .handler(async ({ data }) => {
    const { setResponseHeader } = await import("@tanstack/react-start/server")
    setResponseHeader("Cache-Control", "no-store")
    const user = await requireAuthenticatedUser()
    const catalog = await runAppEffect(
      "backups.listForDownload",
      listBackupCatalogEffect()
    )
    const backup = catalog.find((candidate) => candidate.id === data.backupId)
    if (!backup || backup.status !== "available") {
      throw new Error("Backup is not available")
    }
    const grants = isPlatformAdmin(user) ? [] : await listUserGrants(user.id)
    if (!hasBackupPermission(user, grants, backup, "backup.download")) {
      throw new Error("You do not have permission to download this backup")
    }
    if (!backup.storageId || !backup.objectKey || !backup.filename) {
      throw new Error("Local backup downloads are not available yet")
    }
    const storage = await runAppEffect(
      "backups.loadDownloadStorage",
      loadBackupStorageCredentialEffect(backup.storageId)
    )
    if (!storage) throw new Error("Backup destination is unavailable")
    return runAppEffect(
      "backups.signDownload",
      signS3BackupDownload(storage, backup.objectKey, backup.filename)
    )
  })

export const updateInstanceBackupLimits = createServerFn({ method: "POST" })
  .validator(backupLimitsInputSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    await requireRelayPermission({
      instanceId: data.instanceId,
      permission: "backup.create",
      relayId: data.relayId,
      user,
    })
    if (
      data.scope === "platform" &&
      !hasPlatformPermission(user, "platform.backups.manage-limits")
    ) {
      throw new Error("Platform backup limits require administrator access")
    }
    await runAppEffect(
      "backups.updateLimits",
      updateBackupLimitsEffect({
        admin: data.scope === "platform",
        quantityLimit: data.quantityLimit,
        relayId: data.relayId,
        sizeLimitBytes: data.sizeLimitBytes,
        targetId: data.instanceId,
      })
    )
    return { updated: true }
  })

export const updateInstanceBackupExcludes = createServerFn({ method: "POST" })
  .validator(backupExcludesInputSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    await requireRelayPermission({
      instanceId: data.instanceId,
      permission: "backup.create",
      relayId: data.relayId,
      user,
    })
    await runAppEffect(
      "backups.updateExcludes",
      updateBackupExcludesEffect({
        exclude: data.exclude,
        relayId: data.relayId,
        targetId: data.instanceId,
      })
    )
    return { updated: true }
  })

async function requireBackupRelay(relayId: string): Promise<PersistedRelay> {
  const relay = (await listPersistedRelays()).find(
    (candidate) => candidate.enabled && candidate.id === relayId
  )
  if (!relay) throw new Error("Relay is not available")
  return relay
}

function hasBackupPermission(
  user: AuthenticatedUser,
  grants: ReadonlyArray<AccessGrant>,
  backup: BackupCatalogRecord,
  permission: AccessPermission
): boolean {
  if (isPlatformAdmin(user)) return true
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
