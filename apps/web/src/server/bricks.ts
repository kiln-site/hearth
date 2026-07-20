import { createServerFn } from "@tanstack/react-start"
import {
  brickSchema,
  brickSourceSchema,
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
import { listPersistedRelays } from "@/lib/relay-registry"
import { runAppEffect } from "@/effect/runtime"
import {
  cachedRelayJsonEffect,
  invalidateRelayCache,
  relayCachePolicy,
  relayJsonEffect,
  writeRelayCache,
} from "@/lib/relay-client"
import { requireAuthenticatedUser } from "@/server/auth"

const relayIdSchema = z.object({ relayId: z.uuid() })
const createInputSchema = relayCreateInstanceSchema.extend({
  ...relayIdSchema.shape,
  name: z.string().trim().min(1).max(120),
})
const networkingInputSchema = relayNetworkingSchema.extend(relayIdSchema.shape)
const recipeInputSchema = relayIdSchema.extend({ source: brickSourceSchema })

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
      runAppEffect(
        "relay.bricks",
        cachedRelayJsonEffect({
          decode: relayCatalogSchema.parse,
          fallbackOnError: true,
          path: "/v1/bricks",
          policy: relayCachePolicy.brickCatalog(relay.id),
          relay,
        })
      ),
      runAppEffect(
        "relay.snapshot",
        cachedRelayJsonEffect({
          decode: relaySnapshotSchema.parse,
          fallbackOnError: true,
          path: "/v1/snapshot",
          policy: relayCachePolicy.snapshot(relay.id),
          relay,
        })
      ),
      runAppEffect(
        "relay.networking",
        cachedRelayJsonEffect({
          decode: z.union([relayNetworkingSchema, z.null()]).parse,
          fallbackOnError: true,
          path: "/v1/networking",
          policy: relayCachePolicy.networking(relay.id),
          relay,
        })
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
    await runAppEffect(
      "relay.snapshot.invalidate",
      invalidateRelayCache(relayCachePolicy.snapshot(relay.id))
    )
    return relayInstanceSchema.parse({ ...instance, name: data.name })
  })

export const loadBrickRecipe = createServerFn({ method: "POST" })
  .validator(recipeInputSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    if (!isPlatformAdmin(user)) {
      throw new Error("Platform administrator access required")
    }
    const relay = await requiredRelay(data.relayId)
    return brickSchema.parse(
      await requestRelay(
        relay,
        `/v1/bricks/recipe?source=${encodeURIComponent(data.source)}`
      )
    )
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
    const networking = relayNetworkingSchema.parse(
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
    await runAppEffect(
      "relay.networking.cache",
      writeRelayCache(relayCachePolicy.networking(relay.id), networking)
    )
    return networking
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
  return runAppEffect(
    "relay.json",
    relayJsonEffect(relay, path, (input) => input, init, timeout)
  )
}
