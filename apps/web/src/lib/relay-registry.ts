import { randomUUID } from "node:crypto"

import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"
import { Effect } from "effect"
import { relaySnapshotSchema } from "@workspace/contracts"

import { Database } from "@/effect/database"
import { CredentialError } from "@/effect/errors"
import { runAppEffect } from "@/effect/runtime"
import { databasePool } from "@/lib/database"
import { databaseTable } from "@/lib/database-config"
import { betterAuthSecrets, relayKey } from "@/lib/environment"

import { decryptWithKeyring, encryptWithKeyring } from "../../keyring.mjs"

const RELAY_CREDENTIAL_PURPOSE = "kiln-relay-credential"

export interface PersistedRelay {
  id: string
  name: string
  hostname: string
  port: number
  useTls: boolean
  enabled: boolean
  lastConnectedAt: string | null
  lastError: string | null
  managedEmberCount: number | null
  nodeArch: string | null
  nodePlatform: string | null
  nodeVersion: string | null
  tokenConfigured: boolean
}

interface RelayRow extends RowDataPacket {
  id: string
  name: string
  hostname: string
  port: number
  use_tls: number
  enabled: number
  last_connected_at: Date | null
  last_error: string | null
  managed_ember_count: number | null
  node_arch: string | null
  node_platform: string | null
  node_version: string | null
  token_ciphertext: string | null
}

export async function listPersistedRelays(): Promise<Array<PersistedRelay>> {
  return runAppEffect("relays.list", listPersistedRelaysEffect())
}

export const listPersistedRelaysEffect = Effect.fn("relays.list")(function* () {
  const database = yield* Database
  const rows = yield* database.queryRows<RelayRow>(
    "relays_list",
    `SELECT id, name, hostname, port, use_tls, enabled,
              last_connected_at, last_error, managed_ember_count,
              node_arch, node_platform, node_version, token_ciphertext
         FROM ${databaseTable("relay")}
        ORDER BY name ASC, created_at ASC`
  )
  return rows.map(toPersistedRelay)
})

export async function createPersistedRelay(input: {
  name: string
  hostname: string
  port: number
  useTls: boolean
  token: string
}): Promise<PersistedRelay> {
  const id = randomUUID()
  await databasePool.execute(
    `INSERT INTO ${databaseTable("relay")}
      (id, name, hostname, port, use_tls, token_ciphertext, enabled)
     VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
    [
      id,
      input.name,
      input.hostname,
      input.port,
      input.useTls,
      encryptRelayToken(input.token),
    ]
  )

  await checkPersistedRelay(id)
  const relay = (await listPersistedRelays()).find((item) => item.id === id)
  if (!relay) throw new Error("Relay was saved but could not be read back")
  return relay
}

export async function updatePersistedRelay(input: {
  id: string
  name: string
  hostname: string
  port: number
  token?: string
  useTls: boolean
}): Promise<PersistedRelay> {
  const tokenCiphertext = input.token
    ? encryptRelayToken(input.token)
    : undefined
  const [result] = await databasePool.execute<ResultSetHeader>(
    `UPDATE ${databaseTable("relay")}
        SET name = ?, hostname = ?, port = ?, use_tls = ?,
            token_ciphertext = COALESCE(?, token_ciphertext), enabled = TRUE
      WHERE id = ?`,
    [
      input.name,
      input.hostname,
      input.port,
      input.useTls,
      tokenCiphertext ?? null,
      input.id,
    ]
  )
  if (result.affectedRows !== 1) throw new Error("Relay not found")
  await checkPersistedRelay(input.id)
  const relay = (await listPersistedRelays()).find(
    (item) => item.id === input.id
  )
  if (!relay) throw new Error("Relay was saved but could not be read back")
  return relay
}

export async function deletePersistedRelay(id: string): Promise<void> {
  const [result] = await databasePool.execute<ResultSetHeader>(
    `DELETE FROM ${databaseTable("relay")} WHERE id = ?`,
    [id]
  )
  if (result.affectedRows !== 1) {
    throw new Error("Relay not found")
  }
}

export async function checkPersistedRelay(id: string): Promise<PersistedRelay> {
  const relay = (await listPersistedRelays()).find((item) => item.id === id)
  if (!relay) throw new Error("Relay not found")

  let error: string | null = null
  try {
    const response = await fetch(`${relayUrl(relay)}/v1/snapshot`, {
      headers: await relayHeaders(relay),
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) throw new Error(`Relay returned HTTP ${response.status}`)
    const snapshot = relaySnapshotSchema.parse(await response.json())
    await databasePool.execute(
      `UPDATE ${databaseTable("relay")}
          SET last_connected_at = ?, last_error = NULL,
              managed_ember_count = ?, node_arch = ?, node_platform = ?,
              node_version = ?
        WHERE id = ?`,
      [
        new Date(),
        snapshot.instances.filter((instance) => instance.managedByRelay).length,
        snapshot.node.arch,
        snapshot.node.platform,
        snapshot.node.version,
        id,
      ]
    )
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Could not reach Relay"
    await databasePool.execute(
      `UPDATE ${databaseTable("relay")} SET last_error = ? WHERE id = ?`,
      [error, id]
    )
  }
  const checked = (await listPersistedRelays()).find((item) => item.id === id)
  if (!checked) throw new Error("Relay not found")
  return checked
}

export async function resolveDefaultRelay(): Promise<PersistedRelay | null> {
  return runAppEffect("relays.resolveDefault", resolveDefaultRelayEffect())
}

export const resolveDefaultRelayEffect = Effect.fn("relays.resolveDefault")(
  function* () {
    return (
      (yield* listPersistedRelaysEffect()).find((item) => item.enabled) ?? null
    )
  }
)

export async function relayHeaders(relay?: {
  id: string
}): Promise<Record<string, string>> {
  return runAppEffect("relays.headers", relayHeadersEffect(relay))
}

export const relayHeadersEffect = Effect.fn("relays.headers")(
  function* (relay?: { id: string }) {
    let token: string | null = null
    if (relay) {
      const database = yield* Database
      const rows = yield* database.queryRows<
        { token_ciphertext: string | null } & RowDataPacket
      >(
        "relay_token",
        `SELECT token_ciphertext FROM ${databaseTable("relay")} WHERE id = ? LIMIT 1`,
        [relay.id]
      )
      if (rows[0]?.token_ciphertext) {
        const storedCiphertext = rows[0].token_ciphertext
        const decrypted = yield* Effect.try({
          try: () => decryptRelayToken(storedCiphertext),
          catch: (cause) =>
            CredentialError.make({ operation: "decrypt_relay_token", cause }),
        })
        token = decrypted.plaintext
        if (decrypted.needsRotation) {
          const ciphertext = yield* Effect.try({
            try: () => encryptRelayToken(decrypted.plaintext),
            catch: (cause) =>
              CredentialError.make({ operation: "encrypt_relay_token", cause }),
          })
          yield* database.execute(
            "rotate_relay_token",
            `UPDATE ${databaseTable("relay")}
              SET token_ciphertext = ?
            WHERE id = ? AND token_ciphertext = ?`,
            [ciphertext, relay.id, storedCiphertext]
          )
        }
      }
    }
    token ??= relayKey()
    const headers: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {}
    return headers
  }
)

function relayUrl(relay: PersistedRelay): string {
  return `${relay.useTls ? "https" : "http"}://${relay.hostname}:${relay.port}`
}

function toPersistedRelay(row: RelayRow): PersistedRelay {
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    port: Number(row.port),
    useTls: Boolean(row.use_tls),
    enabled: Boolean(row.enabled),
    lastConnectedAt: row.last_connected_at?.toISOString() ?? null,
    lastError: row.last_error,
    managedEmberCount:
      row.managed_ember_count === null ? null : Number(row.managed_ember_count),
    nodeArch: row.node_arch,
    nodePlatform: row.node_platform,
    nodeVersion: row.node_version,
    tokenConfigured: Boolean(row.token_ciphertext || relayKey()),
  }
}

function encryptRelayToken(token: string): string {
  return encryptWithKeyring(
    token,
    betterAuthSecrets(),
    RELAY_CREDENTIAL_PURPOSE
  )
}

function decryptRelayToken(value: string) {
  return decryptWithKeyring(
    value,
    betterAuthSecrets(),
    RELAY_CREDENTIAL_PURPOSE
  )
}
