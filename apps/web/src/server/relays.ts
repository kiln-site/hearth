import { createServerFn } from "@tanstack/react-start"
import {
  relayIdSchema as relayFingerprintSchema,
  relayProxyDiagnosticsSchema,
  relayProxySettingsSchema,
} from "@workspace/contracts"
import { z } from "zod"

import { isPlatformAdmin } from "@/lib/access-control"
import { requireAuthenticatedUser } from "@/server/auth"

const relayIdSchema = z.object({
  id: relayFingerprintSchema,
})
const relayEnabledSchema = relayIdSchema.extend({ enabled: z.boolean() })
const relayProxyInputSchema = relayProxySettingsSchema.extend({
  relayId: relayFingerprintSchema,
})
const relayProxyResponseSchema = z.object({
  diagnostics: relayProxyDiagnosticsSchema,
  settings: relayProxySettingsSchema,
})
const relayRoleSchema = z.enum(["custom", "full_access", "read_only"])
const createRelaySchema = z.object({
  pairingUri: z.string().trim().min(64).max(32_768),
})
const updateRelaySchema = relayIdSchema.extend({
  hostname: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(
      /^(?:\[[a-f\d:]+\]|[a-z\d.-]+)$/iu,
      "Enter a hostname or IP address"
    ),
  port: z.number().int().min(1).max(65_535),
  useTls: z.boolean(),
})
const renameRelaySchema = z.object({
  name: z.string().trim().min(1).max(120),
  relayId: relayFingerprintSchema,
})
const pairingRoleSchema = z.object({
  relayId: relayFingerprintSchema,
  role: z.enum(["full_access", "read_only"]),
})
const relayInvitationSchema = z.object({
  invitationId: z.uuid(),
  relayId: relayFingerprintSchema,
})
const relayClientSchema = z.object({
  clientId: z.string().min(1).max(128),
  relayId: relayFingerprintSchema,
})
const updateRelayClientSchema = relayClientSchema.extend({
  actions: z.array(z.string().min(1).max(120)).max(128).optional(),
  name: z.string().trim().min(1).max(120),
  role: relayRoleSchema,
  sourceCidrs: z.array(z.string().trim().min(1).max(128)).max(16),
})
const previewPairingSchema = z.object({
  pairingUri: z.string().trim().min(64).max(32_768),
})

async function requireRelayAdministrator() {
  const user = await requireAuthenticatedUser()
  if (!isPlatformAdmin(user))
    throw new Error("Platform administrator access required")
}

export const getRelays = createServerFn({ method: "GET" }).handler(async () => {
  await requireRelayAdministrator()
  const { listPersistedRelays } = await import("@/lib/relay-registry")
  return listPersistedRelays()
})

export const addRelay = createServerFn({ method: "POST" })
  .validator(createRelaySchema)
  .handler(async ({ data }) => {
    await requireRelayAdministrator()
    const { pairPersistedRelay } = await import("@/lib/relay-registry")
    return pairPersistedRelay(data.pairingUri)
  })

export const updateRelay = createServerFn({ method: "POST" })
  .validator(updateRelaySchema)
  .handler(async ({ data }) => {
    await requireRelayAdministrator()
    const { updatePersistedRelay } = await import("@/lib/relay-registry")
    return updatePersistedRelay(data)
  })

export const checkRelay = createServerFn({ method: "POST" })
  .validator(relayIdSchema)
  .handler(async ({ data }) => {
    await requireRelayAdministrator()
    const { checkPersistedRelay } = await import("@/lib/relay-registry")
    return checkPersistedRelay(data.id)
  })

export const setRelayEnabled = createServerFn({ method: "POST" })
  .validator(relayEnabledSchema)
  .handler(async ({ data }) => {
    await requireRelayAdministrator()
    const { setPersistedRelayEnabled } = await import("@/lib/relay-registry")
    return setPersistedRelayEnabled(data.id, data.enabled)
  })

export const removeRelay = createServerFn({ method: "POST" })
  .validator(relayIdSchema)
  .handler(async ({ data }) => {
    await requireRelayAdministrator()
    const { deletePersistedRelay } = await import("@/lib/relay-registry")
    await deletePersistedRelay(data.id)
    return { removed: true }
  })

export const previewRelayPairing = createServerFn({ method: "POST" })
  .validator(previewPairingSchema)
  .handler(async ({ data }) => {
    await requireRelayAdministrator()
    const { previewPairingUri } = await import("@/lib/relay-registry")
    return previewPairingUri(data.pairingUri)
  })

export const getRelayAdministration = createServerFn({ method: "GET" })
  .validator(relayIdSchema)
  .handler(async ({ data }) => {
    await requireRelayAdministrator()
    const registry = await import("@/lib/relay-registry")
    return registry.getRelayAdministration(data.id)
  })

export const createRelayInvitation = createServerFn({ method: "POST" })
  .validator(pairingRoleSchema)
  .handler(async ({ data }) => {
    await requireRelayAdministrator()
    const { createRelayPairingInvitation } =
      await import("@/lib/relay-registry")
    return createRelayPairingInvitation(data)
  })

export const revokeRelayInvitation = createServerFn({ method: "POST" })
  .validator(relayInvitationSchema)
  .handler(async ({ data }) => {
    await requireRelayAdministrator()
    const { revokeRelayPairingInvitation } =
      await import("@/lib/relay-registry")
    return { revoked: await revokeRelayPairingInvitation(data) }
  })

export const updateRelayClient = createServerFn({ method: "POST" })
  .validator(updateRelayClientSchema)
  .handler(async ({ data }) => {
    await requireRelayAdministrator()
    const { updateRelayClientPolicy } = await import("@/lib/relay-registry")
    return updateRelayClientPolicy(data)
  })

export const revokeHearthClient = createServerFn({ method: "POST" })
  .validator(relayClientSchema)
  .handler(async ({ data }) => {
    await requireRelayAdministrator()
    const { revokeRelayClient } = await import("@/lib/relay-registry")
    return { revoked: await revokeRelayClient(data) }
  })

export const renameRelay = createServerFn({ method: "POST" })
  .validator(renameRelaySchema)
  .handler(async ({ data }) => {
    await requireRelayAdministrator()
    const { renamePersistedRelay } = await import("@/lib/relay-registry")
    return renamePersistedRelay(data)
  })

export const getRelayProxy = createServerFn({ method: "GET" })
  .validator(relayIdSchema)
  .handler(async ({ data }) => {
    await requireRelayAdministrator()
    const [{ listPersistedRelays }, { relayRpc }] = await Promise.all([
      import("@/lib/relay-registry"),
      import("@/lib/relay-connection"),
    ])
    const relay = (await listPersistedRelays()).find(
      (candidate) => candidate.enabled && candidate.id === data.id
    )
    if (!relay) throw new Error("Relay is not configured or is paused")
    return relayProxyResponseSchema.parse(
      await relayRpc(relay, "relay.proxy.read", {}, 15_000)
    )
  })

export const updateRelayProxy = createServerFn({ method: "POST" })
  .validator(relayProxyInputSchema)
  .handler(async ({ data }) => {
    await requireRelayAdministrator()
    const [{ listPersistedRelays }, { relayRpc }] = await Promise.all([
      import("@/lib/relay-registry"),
      import("@/lib/relay-connection"),
    ])
    const relay = (await listPersistedRelays()).find(
      (candidate) => candidate.enabled && candidate.id === data.relayId
    )
    if (!relay) throw new Error("Relay is not configured or is paused")
    const settings = relayProxySettingsSchema.parse({
      acmeEmail: data.acmeEmail,
      mode: data.mode,
      traefikImage: data.traefikImage,
    })
    return relayProxyResponseSchema.parse(
      await relayRpc(relay, "relay.proxy.write", settings, 240_000)
    )
  })
