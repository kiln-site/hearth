import { randomUUID, sign } from "node:crypto"

import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import {
  backupDownloadCapabilityPayloadSchema,
  relayIdSchema,
  relaySnapshotSchema,
} from "@workspace/contracts"

import {
  listBackupCatalogEffect,
  reserveBackupDeleteEffect,
  reserveBackupRestoreEffect,
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
} from "@/lib/access-control"
import { hasBackupPermission } from "@/lib/backup-access"
import { relayRpc } from "@/lib/relay-connection"
import { signS3BackupDownload } from "@/lib/backup-storage-s3"
import {
  dispatchBackupTask,
  reconcileRelayBackups,
  scheduleBackupReconciliation,
} from "@/lib/backup-reconciliation"
import {
  listPersistedRelays,
  loadRelayCredentials,
  type PersistedRelay,
} from "@/lib/relay-registry"
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

const backupRestoreInputSchema = z.strictObject({
  backupId: z.uuid(),
  safetyBackup: z.boolean().default(true),
})

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
      .map(({ createdBy: _, objectKey: __, ...backup }) => backup)
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
    if (!backup.filename) throw new Error("Backup filename is unavailable")
    if (!backup.storageId) {
      if (backup.objectKey) throw new Error("Local backup metadata is invalid")
      const relay = await requireBackupRelay(backup.relayId)
      return signLocalBackupDownload(relay, backup, backup.filename, user.id)
    }
    if (!backup.objectKey) throw new Error("Backup object key is unavailable")
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

export const restoreInstanceBackup = createServerFn({ method: "POST" })
  .validator(backupRestoreInputSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const catalog = await runAppEffect(
      "backups.listForRestore",
      listBackupCatalogEffect()
    )
    const backup = catalog.find((candidate) => candidate.id === data.backupId)
    if (
      !backup ||
      backup.status !== "available" ||
      backup.targetKind !== "instance" ||
      backup.artifactKind !== "archive" ||
      backup.backupMode !== "full"
    ) {
      throw new Error("Backup is not available for an instance restore")
    }
    const grants = isPlatformAdmin(user) ? [] : await listUserGrants(user.id)
    if (!hasBackupPermission(user, grants, backup, "backup.restore")) {
      throw new Error("You do not have permission to restore this backup")
    }
    const relay = await requireBackupRelay(backup.relayId)
    if (data.safetyBackup) {
      await requireRelayPermission({
        instanceId: backup.targetId,
        permission: "backup.create",
        relayId: relay.id,
        user,
      })
    }
    const snapshot = relaySnapshotSchema.parse(
      await relayRpc(relay, "relay.snapshot", {}, 15_000, user.id)
    )
    const instance = snapshot.instances.find(
      (candidate) => candidate.id === backup.targetId
    )
    if (!instance) throw new Error("Restore target was not found on this Relay")
    if (
      instance.observedState !== "stopped" ||
      instance.desiredState !== "stopped"
    ) {
      throw new Error("Stop the server before restoring a backup")
    }

    const safety = data.safetyBackup
      ? await runAppEffect(
          "backups.reserveSafety",
          reserveInstanceBackupEffect({
            backupId: randomUUID(),
            createdBy: user.id,
            name: `Before restoring ${backup.name}`.slice(0, 120),
            reason: "pre_restore",
            relayId: relay.id,
            requestedMaxBytes: null,
            targetId: backup.targetId,
            taskId: randomUUID(),
          })
        )
      : null
    const restore = await runAppEffect(
      "backups.reserveRestore",
      reserveBackupRestoreEffect({
        backupId: backup.id,
        dependsOnTaskId: safety?.taskId ?? null,
        requestedBy: user.id,
        taskId: randomUUID(),
      })
    )
    const firstTask = safety ?? restore
    const dispatched = await Promise.allSettled([
      dispatchBackupTask(relay, firstTask, user.id),
    ])
    if (safety && dispatched[0]?.status === "fulfilled") {
      scheduleBackupReconciliation(relay, user.id)
    }
    return {
      relayAccepted: dispatched[0]?.status === "fulfilled",
      restoreTaskId: restore.taskId,
      safetyBackupId: safety?.backupId ?? null,
    }
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

async function signLocalBackupDownload(
  relay: PersistedRelay,
  backup: BackupCatalogRecord,
  filename: string,
  subject: string
) {
  if (relay.role === "custom" && !relay.actions.includes("backup.download")) {
    throw new Error("This Hearth client cannot download Relay backups")
  }
  const credentials = await loadRelayCredentials(relay.id)
  const now = Date.now()
  const expiresAt = now + 5 * 60_000
  const payload = backupDownloadCapabilityPayloadSchema.parse({
    action: "backup.download",
    audience: relay.id,
    backupId: backup.id,
    capabilityId: randomUUID(),
    expiresAt,
    filename,
    issuedAt: now,
    issuer: credentials.clientId,
    subject,
    version: 1,
  })
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signature = sign(
    null,
    Buffer.from(encoded),
    credentials.clientPrivateKeyPem
  ).toString("base64url")
  const url = new URL(
    `/v1/browser/backups/${encodeURIComponent(backup.id)}`,
    relay.browserOrigin
  )
  url.searchParams.set("token", `${encoded}.${signature}`)
  return { expiresAt: new Date(expiresAt).toISOString(), url: url.toString() }
}
