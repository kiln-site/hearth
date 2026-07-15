import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import { isPlatformAdmin } from "@/lib/access-control"
import { requireAuthenticatedUser } from "@/server/auth"

const relayIdSchema = z.object({ id: z.uuid() })
const createRelaySchema = z.object({
  name: z.string().trim().min(1).max(120),
  hostname: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^(?:\[[a-f\d:]+\]|[a-z\d.-]+)$/iu, "Enter a hostname or IP address"),
  port: z.number().int().min(1).max(65_535),
  useTls: z.boolean(),
  token: z.string().min(32).max(512),
})

export const getRelays = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAuthenticatedUser()
  if (!isPlatformAdmin(user)) throw new Error("Platform administrator access required")
  const { listPersistedRelays } = await import("@/lib/relay-registry")
  return listPersistedRelays()
})

export const addRelay = createServerFn({ method: "POST" })
  .validator(createRelaySchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    if (!isPlatformAdmin(user)) throw new Error("Platform administrator access required")
    const { createPersistedRelay } = await import("@/lib/relay-registry")
    return createPersistedRelay(data)
  })

export const selectRelay = createServerFn({ method: "POST" })
  .validator(relayIdSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    if (!isPlatformAdmin(user)) throw new Error("Platform administrator access required")
    const { makePersistedRelayPrimary } = await import("@/lib/relay-registry")
    await makePersistedRelayPrimary(data.id)
    return { selected: true }
  })

export const checkRelay = createServerFn({ method: "POST" })
  .validator(relayIdSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    if (!isPlatformAdmin(user)) throw new Error("Platform administrator access required")
    const { checkPersistedRelay } = await import("@/lib/relay-registry")
    return checkPersistedRelay(data.id)
  })

export const removeRelay = createServerFn({ method: "POST" })
  .validator(relayIdSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    if (!isPlatformAdmin(user)) throw new Error("Platform administrator access required")
    const { deletePersistedRelay } = await import("@/lib/relay-registry")
    await deletePersistedRelay(data.id)
    return { removed: true }
  })
