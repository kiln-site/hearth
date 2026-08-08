import { randomBytes } from "node:crypto"

import { createServerFn } from "@tanstack/react-start"
import {
  databaseEngineSchema,
  databaseIdSchema,
  relayDatabaseNameSchema,
  relayIdSchema,
  relayManagedDatabaseSchema,
} from "@workspace/contracts"
import type { RelayControlOperation } from "@workspace/contracts"
import { Effect, Result } from "effect"
import { z } from "zod"

import {
  createManagedDatabaseRecordEffect,
  deleteManagedDatabaseRecordEffect,
  listManagedDatabaseRecordsEffect,
  loadManagedDatabaseCredentialEffect,
  rotateManagedDatabaseCredentialEffect,
} from "@/effect/managed-databases"
import { runAppEffect } from "@/effect/runtime"
import {
  isPlatformAdmin,
  listUserGrants,
  requireRelayPermission,
} from "@/lib/access-control"
import type { AccessGrant } from "@/lib/access-control"
import type { AuthenticatedUser } from "@/lib/auth-session"
import { isManagedDatabaseNotFoundError } from "@/lib/managed-database-errors"
import { accessPermissions, roleHasPermission } from "@/lib/permissions"
import type { AccessPermission } from "@/lib/permissions"
import type { PersistedRelay } from "@/lib/relay-registry"
import { listPersistedRelays } from "@/lib/relay-registry"
import { requireAuthenticatedUser } from "@/server/auth"

const createDatabaseInputSchema = z.strictObject({
  engine: databaseEngineSchema,
  name: relayDatabaseNameSchema,
  relayId: relayIdSchema,
})
const databaseInputSchema = z.strictObject({
  databaseId: databaseIdSchema,
  relayId: relayIdSchema,
})
const databaseActionInputSchema = databaseInputSchema.extend({
  action: z.enum(["start", "stop", "restart"]),
})
const databaseNetworkInputSchema = databaseInputSchema.extend({
  connected: z.boolean(),
  instanceId: z.string().regex(/^[a-f0-9]{40}$/u),
})
const databaseImportInputSchema = databaseInputSchema.extend({
  content: z.string().max(700_000),
})

const databasePermissions = accessPermissions.filter((permission) =>
  permission.startsWith("database.")
)

export const getManagedDatabases = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireAuthenticatedUser()
    const relays = (await listPersistedRelays()).filter(
      (relay) => relay.enabled
    )
    const grants = isPlatformAdmin(user) ? [] : await listUserGrants(user.id)
    const readableRelays = relays.filter((relay) =>
      hasDatabaseRelayVisibility(user, grants, relay.id)
    )
    const [records, settled] = await Promise.all([
      runAppEffect(
        "managedDatabases.records",
        listManagedDatabaseRecordsEffect()
      ),
      Promise.allSettled(
        readableRelays.map(async (relay) => ({
          databases: z
            .array(relayManagedDatabaseSchema)
            .parse(await databaseRpc(relay, "database.list", {}, 15_000)),
          relay,
        }))
      ),
    ])
    const recordsById = new Map(
      records.map((record) => [
        `${record.relayId}:${record.databaseId}`,
        record,
      ])
    )
    const relayErrors: Array<{
      message: string
      relayId: string
      relayName: string
    }> = []
    const databases = settled.flatMap((result, index) => {
      if (result.status === "rejected") {
        const relay = readableRelays[index]
        if (relay) {
          relayErrors.push({
            message:
              result.reason instanceof Error
                ? result.reason.message
                : "Relay database inventory is unavailable",
            relayId: relay.id,
            relayName: relay.name,
          })
        }
        return []
      }
      const { relay } = result.value
      return result.value.databases.flatMap((database) => {
        const permissions = databasePermissions.filter((permission) =>
          hasDatabasePermission(user, grants, relay.id, database.id, permission)
        )
        if (!permissions.includes("database.read")) return []
        const record = recordsById.get(`${relay.id}:${database.id}`)
        return [
          {
            ...database,
            hasCredentials: Boolean(record),
            permissions,
            relayId: relay.id,
            relayName: relay.name,
          },
        ]
      })
    })
    return {
      databases,
      relayErrors,
      relays: readableRelays.map((relay) => ({
        canCreate: hasDatabasePermission(
          user,
          grants,
          relay.id,
          undefined,
          "database.create"
        ),
        id: relay.id,
        name: relay.name,
      })),
    }
  }
)

export const getManagedDatabaseCredential = createServerFn({ method: "GET" })
  .validator(databaseInputSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    await requireRelayPermission({
      databaseId: data.databaseId,
      permission: "database.credentials.read",
      relayId: data.relayId,
      user,
    })
    const credential = await runAppEffect(
      "managedDatabases.credential",
      loadManagedDatabaseCredentialEffect(data.relayId, data.databaseId)
    )
    if (!credential) throw new Error("Database credentials are unavailable")
    return {
      databaseName: credential.databaseName,
      password: credential.password,
      username: credential.username,
    }
  })

export const createManagedDatabase = createServerFn({ method: "POST" })
  .validator(createDatabaseInputSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const relay = await requiredRelay(data.relayId)
    await requireRelayPermission({
      permission: "database.create",
      relayId: relay.id,
      user,
    })
    const id = randomBytes(20).toString("hex")
    const username = `kiln_${randomBytes(6).toString("hex")}`
    const password = randomBytes(36).toString("base64url")
    const databaseName = `kiln_${id.slice(0, 12)}`
    const created = relayManagedDatabaseSchema.parse(
      await databaseRpc(
        relay,
        "database.create",
        {
          databaseName,
          engine: data.engine,
          id,
          name: data.name,
          password,
          username,
        },
        360_000,
        user.id
      )
    )
    const persisted = await promiseResult(() =>
      runAppEffect(
        "managedDatabases.record.create",
        createManagedDatabaseRecordEffect({
          createdBy: user.id,
          databaseId: id,
          databaseName,
          engine: data.engine,
          name: data.name,
          password,
          relayId: relay.id,
          username,
        })
      )
    )
    if (Result.isFailure(persisted)) {
      await ignorePromise(() =>
        databaseRpc(
          relay,
          "database.delete",
          { databaseId: id, deleteData: true },
          180_000,
          user.id
        )
      )
      throw persisted.failure
    }
    return { ...created, relayId: relay.id, relayName: relay.name }
  })

export const runManagedDatabaseAction = createServerFn({ method: "POST" })
  .validator(databaseActionInputSchema)
  .handler(async ({ data }) => {
    const { relay, user } = await authorizedDatabase(data, "database.power")
    return relayManagedDatabaseSchema.parse(
      await databaseRpc(
        relay,
        "database.action",
        { action: data.action, databaseId: data.databaseId },
        180_000,
        user.id
      )
    )
  })

export const rotateManagedDatabasePassword = createServerFn({ method: "POST" })
  .validator(databaseInputSchema)
  .handler(async ({ data }) => {
    const { relay, user } = await authorizedDatabase(
      data,
      "database.credentials.rotate"
    )
    const credential = await requiredCredential(data.relayId, data.databaseId)
    const nextPassword = randomBytes(36).toString("base64url")
    await databaseRpc(
      relay,
      "database.credentials.rotate",
      {
        currentPassword: credential.password,
        databaseId: data.databaseId,
        nextPassword,
        username: credential.username,
      },
      180_000,
      user.id
    )
    const persisted = await promiseResult(() =>
      runAppEffect(
        "managedDatabases.credential.persistRotation",
        rotateManagedDatabaseCredentialEffect(
          data.relayId,
          data.databaseId,
          nextPassword
        )
      )
    )
    if (Result.isFailure(persisted)) {
      await ignorePromise(() =>
        databaseRpc(
          relay,
          "database.credentials.rotate",
          {
            currentPassword: nextPassword,
            databaseId: data.databaseId,
            nextPassword: credential.password,
            username: credential.username,
          },
          180_000,
          user.id
        )
      )
      throw persisted.failure
    }
    return { rotated: true }
  })

export const updateManagedDatabaseNetwork = createServerFn({ method: "POST" })
  .validator(databaseNetworkInputSchema)
  .handler(async ({ data }) => {
    const { relay, user } = await authorizedDatabase(
      data,
      "database.network.write"
    )
    await requireRelayPermission({
      instanceId: data.instanceId,
      permission: "instance.network.write",
      relayId: data.relayId,
      user,
    })
    return relayManagedDatabaseSchema.parse(
      await databaseRpc(
        relay,
        "database.network.write",
        {
          connected: data.connected,
          databaseId: data.databaseId,
          instanceId: data.instanceId,
        },
        30_000,
        user.id
      )
    )
  })

export const exportManagedDatabase = createServerFn({ method: "POST" })
  .validator(databaseInputSchema)
  .handler(async ({ data }) => {
    const { relay, user } = await authorizedDatabase(
      data,
      "database.dump.export"
    )
    const credential = await requiredCredential(data.relayId, data.databaseId)
    return z
      .object({ content: z.string(), fileName: z.string().min(1).max(180) })
      .parse(
        await databaseRpc(
          relay,
          "database.dump.export",
          {
            databaseId: data.databaseId,
            password: credential.password,
            username: credential.username,
          },
          120_000,
          user.id
        )
      )
  })

export const importManagedDatabase = createServerFn({ method: "POST" })
  .validator(databaseImportInputSchema)
  .handler(async ({ data }) => {
    const { relay, user } = await authorizedDatabase(
      data,
      "database.dump.import"
    )
    const credential = await requiredCredential(data.relayId, data.databaseId)
    await databaseRpc(
      relay,
      "database.dump.import",
      {
        content: data.content,
        databaseId: data.databaseId,
        password: credential.password,
        username: credential.username,
      },
      120_000,
      user.id
    )
    return { imported: true }
  })

export const deleteManagedDatabase = createServerFn({ method: "POST" })
  .validator(databaseInputSchema)
  .handler(async ({ data }) => {
    const { relay, user } = await authorizedDatabase(data, "database.delete")
    const deleted = await promiseResult(() =>
      databaseRpc(
        relay,
        "database.delete",
        { databaseId: data.databaseId, deleteData: true },
        180_000,
        user.id
      )
    )
    if (
      Result.isFailure(deleted) &&
      !isManagedDatabaseNotFoundError(deleted.failure)
    ) {
      throw deleted.failure
    }
    await runAppEffect(
      "managedDatabases.record.delete",
      deleteManagedDatabaseRecordEffect(data.relayId, data.databaseId)
    )
    return { deleted: true }
  })

async function authorizedDatabase(
  data: { databaseId: string; relayId: string },
  permission: AccessPermission
) {
  const user = await requireAuthenticatedUser()
  const relay = await requiredRelay(data.relayId)
  await requireRelayPermission({
    databaseId: data.databaseId,
    permission,
    relayId: data.relayId,
    user,
  })
  return { relay, user }
}

async function requiredCredential(relayId: string, databaseId: string) {
  const credential = await runAppEffect(
    "managedDatabases.credential.internal",
    loadManagedDatabaseCredentialEffect(relayId, databaseId)
  )
  if (!credential) throw new Error("Database credentials are unavailable")
  return credential
}

async function requiredRelay(id: string): Promise<PersistedRelay> {
  const relay = (await listPersistedRelays()).find(
    (candidate) => candidate.enabled && candidate.id === id
  )
  if (!relay) throw new Error("Relay not found")
  return relay
}

function hasDatabasePermission(
  user: AuthenticatedUser,
  grants: ReadonlyArray<AccessGrant>,
  relayId: string,
  databaseId: string | undefined,
  permission: AccessPermission
): boolean {
  if (isPlatformAdmin(user)) return true
  return grants.some(
    (grant) =>
      grant.relayId === relayId &&
      roleHasPermission(grant.role, permission) &&
      (grant.resourceType === "relay" ||
        (grant.resourceType === "database" &&
          databaseId !== undefined &&
          grant.resourceId === databaseId))
  )
}

function hasDatabaseRelayVisibility(
  user: AuthenticatedUser,
  grants: ReadonlyArray<AccessGrant>,
  relayId: string
): boolean {
  if (isPlatformAdmin(user)) return true
  return grants.some(
    (grant) =>
      grant.relayId === relayId &&
      roleHasPermission(grant.role, "database.read") &&
      (grant.resourceType === "relay" || grant.resourceType === "database")
  )
}

async function databaseRpc(
  relay: PersistedRelay,
  operation: RelayControlOperation,
  payload: unknown,
  timeoutMs: number,
  subject?: string
): Promise<unknown> {
  const { relayRpc } = await import("@/lib/relay-connection")
  return relayRpc(relay, operation, payload, timeoutMs, subject)
}

function promiseResult<TResult>(run: () => Promise<TResult>) {
  return Effect.runPromise(
    Effect.result(Effect.tryPromise({ try: run, catch: (cause) => cause }))
  )
}

async function ignorePromise(run: () => Promise<unknown>): Promise<void> {
  await Effect.runPromise(
    Effect.tryPromise({ try: run, catch: (cause) => cause }).pipe(Effect.ignore)
  )
}
