import { randomUUID, sign } from "node:crypto"

import { backupDownloadCapabilityPayloadSchema } from "@workspace/contracts"

import type { BackupCatalogRecord } from "@/effect/backups"
import { loadRelayCredentials, type PersistedRelay } from "@/lib/relay-registry"

export async function signLocalBackupDownload(
  relay: PersistedRelay,
  backup: BackupCatalogRecord,
  filename: string,
  subject: string,
  expiresInSeconds: number
) {
  if (relay.role === "custom" && !relay.actions.includes("backup.download")) {
    throw new Error("This Hearth client cannot download Relay backups")
  }
  const credentials = await loadRelayCredentials(relay.id)
  const now = Date.now()
  const expiresAt = now + expiresInSeconds * 1_000
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
