import { randomUUID } from "node:crypto"

import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"
import { Effect } from "effect"

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
  isPrimary: boolean
  lastConnectedAt: string | null
  lastError: string | null
  tokenConfigured: boolean
}

interface RelayRow extends RowDataPacket {
  id: string
  name: string
  hostname: string
  port: number
  use_tls: number
  enabled: number
  is_primary: number
  last_connected_at: Date | null
  last_error: string | null
  token_ciphertext: string | null
}

export async function listPersistedRelays(): Promise<Array<PersistedRelay>> {
  return runAppEffect("relays.list", listPersistedRelaysEffect())
}

export const listPersistedRelaysEffect = Effect.fn("relays.list")(function* () {
  const database = yield* Database
  const rows = yield* database.queryRows<RelayRow>(
    "relays_list",
    `SELECT id, name, hostname, port, use_tls, enabled, is_primary,
              last_connected_at, last_error, token_ciphertext
         FROM ${databaseTable("relay")}
        ORDER BY is_primary DESC, name ASC, created_at ASC`
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
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const [primaryRows] = await connection.query<Array<RowDataPacket>>(
      `SELECT COUNT(*) AS primary_count FROM ${databaseTable("relay")} WHERE is_primary = TRUE`
    )
    const isPrimary = Number(primaryRows[0]?.primary_count ?? 0) === 0
    await connection.execute(
      `INSERT INTO ${databaseTable("relay")}
        (id, name, hostname, port, use_tls, token_ciphertext, enabled, is_primary)
       VALUES (?, ?, ?, ?, ?, ?, TRUE, ?)`,
      [
        id,
        input.name,
        input.hostname,
        input.port,
        input.useTls,
        encryptRelayToken(input.token),
        isPrimary,
      ]
    )
    await connection.commit()
  } catch (cause) {
    await connection.rollback()
    throw cause
  } finally {
    connection.release()
  }

  await checkPersistedRelay(id)
  const relay = (await listPersistedRelays()).find((item) => item.id === id)
  if (!relay) throw new Error("Relay was saved but could not be read back")
  return relay
}

export async function makePersistedRelayPrimary(id: string): Promise<void> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    await connection.query(
      `UPDATE ${databaseTable("relay")} SET is_primary = FALSE`
    )
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE ${databaseTable("relay")} SET is_primary = TRUE, enabled = TRUE WHERE id = ?`,
      [id]
    )
    if (result.affectedRows !== 1) throw new Error("Relay not found")
    await connection.commit()
  } catch (cause) {
    await connection.rollback()
    throw cause
  } finally {
    connection.release()
  }
}

export async function deletePersistedRelay(id: string): Promise<void> {
  const [result] = await databasePool.execute<ResultSetHeader>(
    `DELETE FROM ${databaseTable("relay")} WHERE id = ? AND is_primary = FALSE`,
    [id]
  )
  if (result.affectedRows !== 1) {
    throw new Error("Make another Relay active before removing this one")
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
    await response.body?.cancel()
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Could not reach Relay"
  }

  await databasePool.execute(
    `UPDATE ${databaseTable("relay")}
        SET last_connected_at = ?, last_error = ?
      WHERE id = ?`,
    [error ? null : new Date(), error, id]
  )
  const checked = (await listPersistedRelays()).find((item) => item.id === id)
  if (!checked) throw new Error("Relay not found")
  return checked
}

export async function resolvePrimaryRelayUrl(): Promise<string | null> {
  const relay = await resolvePrimaryRelay()
  return relay ? relayUrl(relay) : null
}

export async function resolvePrimaryRelay(): Promise<PersistedRelay | null> {
  return runAppEffect("relays.resolvePrimary", resolvePrimaryRelayEffect())
}

export const resolvePrimaryRelayEffect = Effect.fn("relays.resolvePrimary")(
  function* () {
    return (
      (yield* listPersistedRelaysEffect()).find(
        (item) => item.isPrimary && item.enabled
      ) ?? null
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
    isPrimary: Boolean(row.is_primary),
    lastConnectedAt: row.last_connected_at?.toISOString() ?? null,
    lastError: row.last_error,
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
