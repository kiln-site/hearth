import { randomBytes } from "node:crypto"

import { createServerFn } from "@tanstack/react-start"
import {
  builtinTailscaleBrickId,
  relayIdSchema,
  relayInstanceNameSchema,
  relaySnapshotSchema,
  relayTailscaleDomainSchema,
  relayTailscaleInstallSchema,
  relayTailscaleStackIdSchema,
  relayTailscaleStackSchema,
  relayTailscaleStacksSchema,
  relayTailscaleSubdomainSchema,
} from "@workspace/contracts"
import { z } from "zod"

import { isPlatformAdmin } from "@/lib/access-control"
import { invalidateRelayCache, relayCachePolicy } from "@/lib/relay-client"
import { relayRpc } from "@/lib/relay-connection"
import type { PersistedRelay } from "@/lib/relay-registry"
import { listPersistedRelays } from "@/lib/relay-registry"
import { requireAuthenticatedUser } from "@/server/auth"
import { runAppEffect } from "@/effect/runtime"
import type { RelaySnapshot, RelayTailscaleStack } from "@workspace/contracts"

const stackBindingInputSchema = z.strictObject({
  hostname: relayTailscaleSubdomainSchema,
  instanceId: z.string().regex(/^[a-f0-9]{40}$/u),
  relayId: relayIdSchema,
})

const saveTailscaleStackSchema = z.strictObject({
  authKey: relayTailscaleInstallSchema.shape.authKey.optional(),
  bindings: z.array(stackBindingInputSchema).max(4_096),
  domain: relayTailscaleDomainSchema,
  id: relayTailscaleStackIdSchema.optional(),
  name: relayInstanceNameSchema,
})

const removeTailscaleStackSchema = z.strictObject({
  id: relayTailscaleStackIdSchema,
})

export interface TailscaleDeployment extends RelayTailscaleStack {
  relayId: string
  relayName: string
}

export interface TailscaleStackOverview {
  bindings: Array<{
    address: string
    hostname: string
    instanceId: string
    relayId: string
    relayName: string
  }>
  deployments: Array<TailscaleDeployment>
  domain: string
  id: string
  name: string
}

export const getTailscaleStacks = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireTailscaleAdministrator()
    return loadTailscaleStacks()
  }
)

export const saveTailscaleStack = createServerFn({ method: "POST" })
  .validator(saveTailscaleStackSchema)
  .handler(async ({ data }) => {
    await requireTailscaleAdministrator()
    const relays = (await listPersistedRelays()).filter(
      (relay) => relay.enabled
    )
    const relayById = new Map(relays.map((relay) => [relay.id, relay]))
    const id = data.id ?? randomBytes(32).toString("hex").slice(0, 40)
    const duplicateHostname = data.bindings.find(
      (binding, index, bindings) =>
        bindings.findIndex(
          (candidate) => candidate.hostname === binding.hostname
        ) !== index
    )
    if (duplicateHostname) {
      throw new Error(
        `Hostname ${duplicateHostname.hostname}.${data.domain} is selected more than once`
      )
    }

    const grouped = new Map<string, typeof data.bindings>()
    for (const binding of data.bindings) {
      const relay = relayById.get(binding.relayId)
      if (!relay) throw new Error("A selected server's node is unavailable")
      const relayBindings = grouped.get(binding.relayId) ?? []
      relayBindings.push(binding)
      grouped.set(binding.relayId, relayBindings)
    }

    const currentDeploymentsPromise = loadTailscaleDeployments(relays)
    const snapshots = new Map<string, RelaySnapshot>()
    await Promise.all(
      [...grouped.keys()].map(async (relayId) => {
        const relay = relayById.get(relayId)!
        const snapshot = relaySnapshotSchema.parse(
          await relayRpc(relay, "relay.snapshot", {}, 30_000)
        )
        snapshots.set(relayId, snapshot)
      })
    )
    for (const binding of data.bindings) {
      const instance = snapshots
        .get(binding.relayId)
        ?.instances.find((candidate) => candidate.id === binding.instanceId)
      if (!instance || !instance.managedByRelay) {
        throw new Error(
          `Server ${binding.instanceId.slice(0, 8)} is unavailable`
        )
      }
      if (instance.brickId === builtinTailscaleBrickId) {
        throw new Error("A Tailscale deployment cannot attach to itself")
      }
    }

    const current = await currentDeploymentsPromise
    const currentForStack = current.filter((deployment) => deployment.id === id)
    if (grouped.size === 0) {
      const [anchor, ...removed] = currentForStack
      if (!anchor) {
        throw new Error("Select at least one server to create this network")
      }
      const relay = relayById.get(anchor.relayId)
      if (!relay) throw new Error("The network's node is unavailable")
      relayTailscaleStackSchema.parse(
        await relayRpc(
          relay,
          "relay.tailscale.stack.apply",
          {
            bindings: [],
            domain: data.domain,
            hostname: deploymentHostname(data.name, relay.name, relay.id),
            id,
            name: data.name,
          },
          240_000
        )
      )
      const synchronized = relayTailscaleStackSchema.parse(
        await relayRpc(
          relay,
          "relay.tailscale.stack.dns",
          { id, records: [] },
          60_000
        )
      )
      await removeDeployments(removed, relayById)
      await invalidateRelaySnapshots([
        anchor.relayId,
        ...removed.map(({ relayId }) => relayId),
      ])
      return groupTailscaleDeployments([
        ...current.filter((deployment) => deployment.id !== id),
        {
          ...synchronized,
          relayId: anchor.relayId,
          relayName: relay.name,
        },
      ])
    }

    const applied = await Promise.all(
      [...grouped.entries()].map(async ([relayId, bindings]) => {
        const relay = relayById.get(relayId)!
        const stack = relayTailscaleStackSchema.parse(
          await relayRpc(
            relay,
            "relay.tailscale.stack.apply",
            {
              authKey: data.authKey,
              bindings: bindings.map(({ hostname, instanceId }) => ({
                hostname,
                instanceId,
              })),
              domain: data.domain,
              hostname: deploymentHostname(data.name, relay.name, relay.id),
              id,
              name: data.name,
            },
            240_000
          )
        )
        return { ...stack, relayId, relayName: relay.name }
      })
    )

    const records = applied.flatMap((deployment) =>
      deployment.bindings.map(({ address, hostname }) => ({
        address,
        hostname,
      }))
    )
    const synchronized = await Promise.all(
      applied.map(async (deployment) => {
        const relay = relayById.get(deployment.relayId)!
        const stack = relayTailscaleStackSchema.parse(
          await relayRpc(
            relay,
            "relay.tailscale.stack.dns",
            { id, records },
            60_000
          )
        )
        return {
          ...stack,
          relayId: deployment.relayId,
          relayName: deployment.relayName,
        }
      })
    )

    const desiredRelayIds = new Set(grouped.keys())
    const removed = currentForStack.filter(
      ({ relayId }) => !desiredRelayIds.has(relayId)
    )
    await removeDeployments(removed, relayById)
    await invalidateRelaySnapshots([
      ...desiredRelayIds,
      ...removed.map(({ relayId }) => relayId),
    ])
    return groupTailscaleDeployments([
      ...current.filter((deployment) => deployment.id !== id),
      ...synchronized,
    ])
  })

export const removeTailscaleStack = createServerFn({ method: "POST" })
  .validator(removeTailscaleStackSchema)
  .handler(async ({ data }) => {
    await requireTailscaleAdministrator()
    const relays = (await listPersistedRelays()).filter(
      (relay) => relay.enabled
    )
    const relayById = new Map(relays.map((relay) => [relay.id, relay]))
    const deployments = (await loadTailscaleDeployments(relays)).filter(
      (deployment) => deployment.id === data.id
    )
    await removeDeployments(deployments, relayById)
    await invalidateRelaySnapshots(deployments.map(({ relayId }) => relayId))
    return { removed: true }
  })

async function requireTailscaleAdministrator() {
  const user = await requireAuthenticatedUser()
  if (!isPlatformAdmin(user)) {
    throw new Error("Platform administrator access required")
  }
}

async function loadTailscaleStacks(): Promise<Array<TailscaleStackOverview>> {
  const relays = (await listPersistedRelays()).filter((relay) => relay.enabled)
  const deployments = await loadTailscaleDeployments(relays)
  return groupTailscaleDeployments(deployments)
}

function groupTailscaleDeployments(
  deployments: ReadonlyArray<TailscaleDeployment>
): Array<TailscaleStackOverview> {
  const grouped = new Map<string, TailscaleStackOverview>()
  for (const deployment of deployments) {
    const stack = grouped.get(deployment.id) ?? {
      bindings: [],
      deployments: [],
      domain: deployment.domain,
      id: deployment.id,
      name: deployment.name,
    }
    stack.deployments.push(deployment)
    stack.bindings.push(
      ...deployment.bindings.map((binding) => ({
        ...binding,
        relayId: deployment.relayId,
        relayName: deployment.relayName,
      }))
    )
    grouped.set(deployment.id, stack)
  }
  return [...grouped.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  )
}

async function loadTailscaleDeployments(
  relays: ReadonlyArray<PersistedRelay>
): Promise<Array<TailscaleDeployment>> {
  const settled = await Promise.allSettled(
    relays.map(async (relay) => {
      const stacks = relayTailscaleStacksSchema.parse(
        await relayRpc(relay, "relay.tailscale.stack.list", {}, 5_000)
      )
      return stacks.map((stack) => ({
        ...stack,
        relayId: relay.id,
        relayName: relay.name,
      }))
    })
  )
  return settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  )
}

async function removeDeployments(
  deployments: ReadonlyArray<TailscaleDeployment>,
  relayById: ReadonlyMap<string, PersistedRelay>
): Promise<void> {
  await Promise.all(
    deployments.map(({ id, relayId }) => {
      const relay = relayById.get(relayId)
      if (!relay) return Promise.resolve()
      return relayRpc(relay, "relay.tailscale.stack.remove", { id }, 120_000)
    })
  )
}

async function invalidateRelaySnapshots(
  relayIds: ReadonlyArray<string>
): Promise<void> {
  await Promise.all(
    [...new Set(relayIds)].map((relayId) =>
      runAppEffect(
        "relay.tailscale.snapshot.invalidate",
        invalidateRelayCache(relayCachePolicy.snapshot(relayId))
      )
    )
  )
}

function deploymentHostname(
  stackName: string,
  relayName: string,
  relayId: string
): string {
  const slug = `${stackName}-${relayName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
  const suffix = relayId.slice(0, 6).toLowerCase()
  return `${slug.slice(0, Math.max(1, 56 - suffix.length)).replace(/-+$/u, "")}-${suffix}`
}
