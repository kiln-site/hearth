import { createServerFn } from "@tanstack/react-start"
import {
  relayCatalogSchema,
  relayCreateInstanceSchema,
  relayInstanceSchema,
  relayNetworkingSchema,
  relaySnapshotSchema,
} from "@workspace/contracts"
import { z } from "zod"

import { isPlatformAdmin } from "@/lib/access-control"
import {
  applyInstanceDisplayNames,
  saveInstanceDisplayName,
} from "@/lib/instance-registry"
import type { PersistedRelay } from "@/lib/relay-registry"
import { listPersistedRelays, relayHeaders } from "@/lib/relay-registry"
import { requireAuthenticatedUser } from "@/server/auth"

const relayIdSchema = z.object({ relayId: z.uuid() })
const createInputSchema = relayCreateInstanceSchema.extend({
  ...relayIdSchema.shape,
  name: z.string().trim().min(1).max(120),
})
const networkingInputSchema = relayNetworkingSchema.extend(relayIdSchema.shape)

export const getBrickStudio = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireAuthenticatedUser()
    if (!isPlatformAdmin(user)) {
      throw new Error("Platform administrator access required")
    }
    const relays = await listPersistedRelays()
    const relay = relays.find((item) => item.isPrimary) ?? relays.at(0)
    if (!relay)
      return {
        relays,
        relayId: null,
        bricks: [],
        instances: [],
        networking: null,
      }
    const [catalog, snapshot, networking] = await Promise.all([
      requestRelay(relay, "/v1/bricks").then((value) =>
        relayCatalogSchema.parse(value)
      ),
      requestRelay(relay, "/v1/snapshot").then((value) =>
        relaySnapshotSchema.parse(value)
      ),
      requestRelay(relay, "/v1/networking").then((value) =>
        z.union([relayNetworkingSchema, z.null()]).parse(value)
      ),
    ])
    return {
      relays,
      relayId: relay.id,
      bricks: catalog.bricks,
      instances: await applyInstanceDisplayNames(relay.id, snapshot.instances),
      networking,
    }
  }
)

export const createBrickInstance = createServerFn({ method: "POST" })
  .validator(createInputSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    if (!isPlatformAdmin(user)) {
      throw new Error("Platform administrator access required")
    }
    const relay = await requiredRelay(data.relayId)
    const input = relayCreateInstanceSchema.parse(data)
    const instance = relayInstanceSchema.parse(
      await requestRelay(
        relay,
        "/v1/instances",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
        360_000
      )
    )
    await saveInstanceDisplayName(relay.id, instance.id, data.name)
    return relayInstanceSchema.parse({ ...instance, name: data.name })
  })

export const configureBrickNetworking = createServerFn({ method: "POST" })
  .validator(networkingInputSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    if (!isPlatformAdmin(user)) {
      throw new Error("Platform administrator access required")
    }
    const relay = await requiredRelay(data.relayId)
    const input = relayNetworkingSchema.parse(data)
    return relayNetworkingSchema.parse(
      await requestRelay(
        relay,
        "/v1/networking",
        {
          method: "PUT",
          body: JSON.stringify(input),
        },
        240_000
      )
    )
  })

async function requiredRelay(id: string): Promise<PersistedRelay> {
  const relay = (await listPersistedRelays()).find((item) => item.id === id)
  if (!relay) throw new Error("Relay not found")
  return relay
}

async function requestRelay(
  relay: PersistedRelay,
  path: string,
  init?: RequestInit,
  timeout = 15_000
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(
      `${relay.useTls ? "https" : "http"}://${relay.hostname}:${relay.port}${path}`,
      {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...(await relayHeaders(relay)),
          ...init?.headers,
        },
        signal: AbortSignal.timeout(timeout),
      }
    )
  } catch (cause) {
    throw new Error(
      cause instanceof Error
        ? `Could not reach Relay: ${cause.message}`
        : "Could not reach Relay"
    )
  }
  const body = (await response.json().catch(() => null)) as {
    error?: string
  } | null
  if (!response.ok) {
    throw new Error(body?.error ?? `Relay returned HTTP ${response.status}`)
  }
  return body
}
