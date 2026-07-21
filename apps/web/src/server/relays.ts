import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import { isPlatformAdmin } from "@/lib/access-control"
import { requireAuthenticatedUser } from "@/server/auth"

const relayIdSchema = z.object({ id: z.uuid() })
const relayEnabledSchema = relayIdSchema.extend({ enabled: z.boolean() })
const createRelaySchema = z.object({
  name: z.string().trim().min(1).max(120),
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
  token: z.string().trim().min(32).max(512),
})
const updateRelaySchema = createRelaySchema.omit({ token: true }).extend({
  id: z.uuid(),
  token: z.string().trim().min(32).max(512).optional(),
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
    const { createPersistedRelay } = await import("@/lib/relay-registry")
    return createPersistedRelay({ ...data, useTls: true })
  })

export const updateRelay = createServerFn({ method: "POST" })
  .validator(updateRelaySchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    if (!isPlatformAdmin(user))
      throw new Error("Platform administrator access required")
    const { updatePersistedRelay } = await import("@/lib/relay-registry")
    return updatePersistedRelay({ ...data, useTls: true })
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
