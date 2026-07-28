import type { RowDataPacket } from "mysql2/promise"
import { Effect } from "effect"
import { z } from "zod"

import {
  relayInstanceNameSchema,
  relayTailscaleDomainSchema,
  relayTailscaleStackIdSchema,
} from "@workspace/contracts"

import { Database } from "@/effect/database"
import { CredentialError, ResourceNotFoundError } from "@/effect/errors"
import { databaseTable } from "@/lib/database-config"
import { betterAuthSecrets } from "@/lib/environment"

import { decryptWithKeyring, encryptWithKeyring } from "../../keyring.mjs"

const TAILSCALE_OAUTH_SECRET_PURPOSE = "kiln-tailscale-oauth-client-secret"
const stringArraySchema = z.array(z.string().min(1)).max(128)

export interface TailscaleIntegration {
  clientId: string
  lastError: string | null
  lastSyncedAt: string | null
  scopes: Array<string>
  tags: Array<string>
}

export interface TailscaleOAuthCredential {
  clientId: string
  clientSecret: string
  scopes: Array<string>
  tags: Array<string>
}

export interface TailscaleNetworkDefinition {
  domain: string
  id: string
  integration: TailscaleIntegration | null
  name: string
}

interface TailscaleNetworkRow extends RowDataPacket {
  domain: string
  id: string
  name: string
  oauth_client_id: string | null
  oauth_client_secret_ciphertext: string | null
  oauth_last_error: string | null
  oauth_last_synced_at: Date | string | null
  oauth_scopes: unknown
  oauth_tags: unknown
}

export const loadTailscaleNetworkDefinitionsEffect = Effect.fn(
  "tailscaleNetworks.load"
)(function* () {
  const database = yield* Database
  const rows = yield* database.queryRows<TailscaleNetworkRow>(
    "tailscaleNetworks.load",
    `SELECT id, name, domain, oauth_client_id,
            oauth_client_secret_ciphertext, oauth_scopes, oauth_tags,
            oauth_last_synced_at, oauth_last_error
       FROM ${databaseTable("tailscale_network")}
      ORDER BY name, id`
  )
  return rows.map((row) => ({
    domain: relayTailscaleDomainSchema.parse(row.domain),
    id: relayTailscaleStackIdSchema.parse(row.id),
    integration: publicIntegration(row),
    name: relayInstanceNameSchema.parse(row.name),
  }))
})

export const saveTailscaleNetworkDefinitionEffect = Effect.fn(
  "tailscaleNetworks.save"
)(function* (definition: TailscaleNetworkDefinition) {
  const database = yield* Database
  yield* database.transaction("tailscaleNetworks.save", async (transaction) => {
    const existing = await transaction.queryRows<RowDataPacket>(
      `SELECT id
         FROM ${databaseTable("tailscale_network")}
        WHERE id = ?
        LIMIT 1
          FOR UPDATE`,
      [definition.id]
    )
    if (existing.length > 0) {
      await transaction.execute(
        `UPDATE ${databaseTable("tailscale_network")}
            SET name = ?, domain = ?
          WHERE id = ?`,
        [definition.name, definition.domain, definition.id]
      )
      return
    }
    await transaction.execute(
      `INSERT INTO ${databaseTable("tailscale_network")} (id, name, domain)
       VALUES (?, ?, ?)`,
      [definition.id, definition.name, definition.domain]
    )
  })
})

export const saveTailscaleNetworkIntegrationEffect = Effect.fn(
  "tailscaleNetworks.integration.save"
)(function* (
  id: string,
  credential: Omit<TailscaleOAuthCredential, "clientSecret">,
  clientSecret: string
) {
  const database = yield* Database
  const ciphertext = yield* Effect.try({
    try: () =>
      encryptWithKeyring(
        clientSecret,
        betterAuthSecrets(),
        TAILSCALE_OAUTH_SECRET_PURPOSE
      ),
    catch: (cause) =>
      CredentialError.make({
        operation: "encrypt_tailscale_oauth_secret",
        cause,
      }),
  })
  const result = yield* database.execute(
    "tailscaleNetworks.integration.save",
    `UPDATE ${databaseTable("tailscale_network")}
        SET oauth_client_id = ?,
            oauth_client_secret_ciphertext = ?,
            oauth_scopes = ?,
            oauth_tags = ?,
            oauth_last_synced_at = NULL,
            oauth_last_error = NULL
      WHERE id = ?`,
    [
      credential.clientId,
      ciphertext,
      JSON.stringify(credential.scopes),
      JSON.stringify(credential.tags),
      id,
    ]
  )
  if (result.affectedRows === 0) {
    return yield* ResourceNotFoundError.make({
      resource: "tailscale_network",
      message: "Tailscale network not found",
    })
  }
})

export const loadTailscaleNetworkCredentialEffect = Effect.fn(
  "tailscaleNetworks.integration.load"
)(function* (id: string) {
  const database = yield* Database
  const rows = yield* database.queryRows<TailscaleNetworkRow>(
    "tailscaleNetworks.integration.load",
    `SELECT id, name, domain, oauth_client_id,
            oauth_client_secret_ciphertext, oauth_scopes, oauth_tags,
            oauth_last_synced_at, oauth_last_error
       FROM ${databaseTable("tailscale_network")}
      WHERE id = ?
      LIMIT 1`,
    [id]
  )
  const row = rows[0]
  if (!row?.oauth_client_id || !row.oauth_client_secret_ciphertext) {
    return yield* ResourceNotFoundError.make({
      resource: "tailscale_oauth_credential",
      message: "Connect Kiln to Tailscale first",
    })
  }
  const ciphertext = row.oauth_client_secret_ciphertext
  const decrypted = yield* Effect.try({
    try: () =>
      decryptWithKeyring(
        ciphertext,
        betterAuthSecrets(),
        TAILSCALE_OAUTH_SECRET_PURPOSE
      ),
    catch: (cause) =>
      CredentialError.make({
        operation: "decrypt_tailscale_oauth_secret",
        cause,
      }),
  })
  if (decrypted.needsRotation) {
    const rotated = yield* Effect.try({
      try: () =>
        encryptWithKeyring(
          decrypted.plaintext,
          betterAuthSecrets(),
          TAILSCALE_OAUTH_SECRET_PURPOSE
        ),
      catch: (cause) =>
        CredentialError.make({
          operation: "rotate_tailscale_oauth_secret",
          cause,
        }),
    })
    yield* database.execute(
      "tailscaleNetworks.integration.rotate",
      `UPDATE ${databaseTable("tailscale_network")}
          SET oauth_client_secret_ciphertext = ?
        WHERE id = ? AND oauth_client_secret_ciphertext = ?`,
      [rotated, id, ciphertext]
    )
  }
  return {
    clientId: row.oauth_client_id,
    clientSecret: decrypted.plaintext,
    scopes: parseStringArray(row.oauth_scopes),
    tags: parseStringArray(row.oauth_tags),
  } satisfies TailscaleOAuthCredential
})

export const recordTailscaleNetworkSyncEffect = Effect.fn(
  "tailscaleNetworks.integration.recordSync"
)(function* (id: string, error: string | null) {
  const database = yield* Database
  if (error) {
    yield* database.execute(
      "tailscaleNetworks.integration.recordSyncError",
      `UPDATE ${databaseTable("tailscale_network")}
          SET oauth_last_error = ?
        WHERE id = ?`,
      [error.slice(0, 512), id]
    )
    return
  }
  yield* database.execute(
    "tailscaleNetworks.integration.recordSyncSuccess",
    `UPDATE ${databaseTable("tailscale_network")}
        SET oauth_last_synced_at = CURRENT_TIMESTAMP(3),
            oauth_last_error = NULL
      WHERE id = ?`,
    [id]
  )
})

export const removeTailscaleNetworkDefinitionEffect = Effect.fn(
  "tailscaleNetworks.remove"
)(function* (id: string) {
  const database = yield* Database
  yield* database.execute(
    "tailscaleNetworks.remove",
    `DELETE FROM ${databaseTable("tailscale_network")} WHERE id = ?`,
    [id]
  )
})

function publicIntegration(
  row: TailscaleNetworkRow
): TailscaleIntegration | null {
  if (!row.oauth_client_id || !row.oauth_client_secret_ciphertext) return null
  return {
    clientId: row.oauth_client_id,
    lastError: row.oauth_last_error,
    lastSyncedAt: timestamp(row.oauth_last_synced_at),
    scopes: parseStringArray(row.oauth_scopes),
    tags: parseStringArray(row.oauth_tags),
  }
}

function parseStringArray(value: unknown): Array<string> {
  const decoded = decodeJson(value)
  const parsed = stringArraySchema.safeParse(decoded)
  if (!parsed.success) return []
  return parsed.data
}

function decodeJson(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function timestamp(value: Date | string | null): string | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.valueOf()) ? null : date.toISOString()
}
