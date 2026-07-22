import { createServerFn } from "@tanstack/react-start"
import { relayIdSchema as relayFingerprintSchema } from "@workspace/contracts"
import { z } from "zod"

import { isPlatformAdmin } from "@/lib/access-control"
import { requireAuthenticatedUser } from "@/server/auth"

const relayIdSchema = z.object({
  id: relayFingerprintSchema,
})
const relayEnabledSchema = relayIdSchema.extend({ enabled: z.boolean() })
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

export const getRelays = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAuthenticatedUser()
  if (!isPlatformAdmin(user))
    throw new Error("Platform administrator access required")
  const { listPersistedRelays } = await import("@/lib/relay-registry")
  return listPersistedRelays()
})

export const addRelay = createServerFn({ method: "POST" })
  .validator(createRelaySchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    if (!isPlatformAdmin(user))
      throw new Error("Platform administrator access required")
    const { pairPersistedRelay } = await import("@/lib/relay-registry")
    return pairPersistedRelay(data.pairingUri)
  })

export const updateRelay = createServerFn({ method: "POST" })
  .validator(updateRelaySchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    if (!isPlatformAdmin(user))
      throw new Error("Platform administrator access required")
    const { updatePersistedRelay } = await import("@/lib/relay-registry")
    return updatePersistedRelay(data)
  })

export const checkRelay = createServerFn({ method: "POST" })
  .validator(relayIdSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    if (!isPlatformAdmin(user))
      throw new Error("Platform administrator access required")
    const { checkPersistedRelay } = await import("@/lib/relay-registry")
    return checkPersistedRelay(data.id)
  })

export const setRelayEnabled = createServerFn({ method: "POST" })
  .validator(relayEnabledSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    if (!isPlatformAdmin(user))
      throw new Error("Platform administrator access required")
    const { setPersistedRelayEnabled } = await import("@/lib/relay-registry")
    return setPersistedRelayEnabled(data.id, data.enabled)
  })

export const removeRelay = createServerFn({ method: "POST" })
  .validator(relayIdSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    if (!isPlatformAdmin(user))
      throw new Error("Platform administrator access required")
    const { deletePersistedRelay } = await import("@/lib/relay-registry")
    await deletePersistedRelay(data.id)
    return { removed: true }
  })
