import { createServerFn } from "@tanstack/react-start"
import {
  brickSchema,
  brickSourceSchema,
  brickVariableValuesSchema,
  relayCatalogSchema,
  relayCreateInstanceSchema,
  relayInstanceNameSchema,
  relayInstanceSchema,
  relayIdSchema,
  relayNetworkingSchema,
  relaySnapshotSchema,
  relayUpdateInstanceStartupSchema,
} from "@workspace/contracts"
import { z } from "zod"

import { isPlatformAdmin, requireRelayPermission } from "@/lib/access-control"
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

const relayInputSchema = z.object({ relayId: relayIdSchema })
const createInputSchema = relayCreateInstanceSchema.extend({
  ...relayInputSchema.shape,
  name: relayInstanceNameSchema,
})
const networkingInputSchema = relayNetworkingSchema.extend(
  relayInputSchema.shape
)
const recipeInputSchema = relayInputSchema.extend({ source: brickSourceSchema })
const instanceInputSchema = relayInputSchema.extend({
  instanceId: z.string().regex(/^[a-f0-9]{40}$/u),
})
const startupInputSchema = relayUpdateInstanceStartupSchema.extend(
  instanceInputSchema.shape
)

export const getBrickCatalog = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireAuthenticatedUser()
    if (!isPlatformAdmin(user)) {
      throw new Error("Platform administrator access required")
    }
    const relays = (await listPersistedRelays()).filter(
      (relay) => relay.enabled
    )
    const relay = relays.at(0)
    if (!relay) return { relays, bricks: [] }
    const catalog = await runAppEffect(
      "relay.bricks",
      cachedRelayJsonEffect({
        decode: relayCatalogSchema.parse,
        fallbackOnError: true,
        path: "/v1/bricks",
        policy: relayCachePolicy.brickCatalog(relay.id),
        relay,
      })
    )
    return {
      relays,
      bricks: catalog.bricks,
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
    await runAppEffect(
      "relay.snapshot.invalidate",
      invalidateRelayCache(relayCachePolicy.snapshot(relay.id))
    )
    return instance
  })

export const getInstanceStartup = createServerFn({ method: "GET" })
  .validator(instanceInputSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const relay = await requiredRelay(data.relayId)
    await requireRelayPermission({
      user,
      relayId: relay.id,
      permission: "instance.settings",
      instanceId: data.instanceId,
    })
    const snapshot = relaySnapshotSchema.parse(
      await requestRelay(relay, "/v1/snapshot")
    )
    const instance = snapshot.instances.find(
      (candidate) => candidate.id === data.instanceId
    )
    if (!instance) throw new Error("Instance not found")
    let brickSource = instance.brickSource
    if (!brickSource && instance.brickId) {
      const catalog = relayCatalogSchema.parse(
        await requestRelay(relay, "/v1/bricks")
      )
      brickSource = catalog.bricks.find(
        (candidate) => candidate.metadata.id === instance.brickId
      )?.source
    }
    if (!brickSource) {
      throw new Error("This server has no Brick recipe to configure")
    }
    const brick = brickSchema.parse(
      await requestRelay(
        relay,
        `/v1/bricks/recipe?source=${encodeURIComponent(brickSource)}`
      )
    )
    const variables =
      instance.variables ??
      Object.fromEntries(
        Object.entries(brick.variables).flatMap(([name, definition]) =>
          definition.default === undefined ? [] : [[name, definition.default]]
        )
      )
    return {
      brick,
      brickSource,
      instance: relayInstanceSchema.parse(instance),
      variables: brickVariableValuesSchema.parse(variables),
    }
  })

export const updateInstanceStartup = createServerFn({ method: "POST" })
  .validator(startupInputSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const relay = await requiredRelay(data.relayId)
    await requireRelayPermission({
      user,
      relayId: relay.id,
      permission: "instance.settings",
      instanceId: data.instanceId,
    })
    const input = relayUpdateInstanceStartupSchema.parse(data)
    const instance = relayInstanceSchema.parse(
      await requestRelay(
        relay,
        `/v1/instances/${encodeURIComponent(data.instanceId)}/startup`,
        {
          method: "PUT",
          body: JSON.stringify(input),
        },
        360_000
      )
    )
    await runAppEffect(
      "relay.snapshot.invalidate",
      invalidateRelayCache(relayCachePolicy.snapshot(relay.id))
    )
    return instance
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
  const relay = (await listPersistedRelays()).find(
    (item) => item.enabled && item.id === id
  )
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
