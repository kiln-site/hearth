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

import {
  loadTailscaleNetworkDefinitionsEffect,
  removeTailscaleNetworkDefinitionEffect,
  saveTailscaleNetworkDefinitionEffect,
  type TailscaleNetworkDefinition,
} from "@/effect/tailscale-networks"
import { runAppEffect } from "@/effect/runtime"
import { isPlatformAdmin } from "@/lib/access-control"
import { invalidateRelayCache, relayCachePolicy } from "@/lib/relay-client"
import { relayRpc } from "@/lib/relay-connection"
import type { PersistedRelay } from "@/lib/relay-registry"
import { listPersistedRelays } from "@/lib/relay-registry"
import { requireAuthenticatedUser } from "@/server/auth"
import {
  applyTailscaleDeploymentPlan,
  type DesiredTailscaleDeployment,
} from "@/server/tailscale-orchestration"
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

export interface TailscaleStacksResult {
  stacks: Array<TailscaleStackOverview>
  unavailableRelays: Array<{
    id: string
    message: string
    name: string
  }>
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
    const definitionsPromise = loadTailscaleNetworkDefinitions()
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

    const currentResult = await currentDeploymentsPromise
    requireCompleteTailscaleDeploymentList(currentResult.unavailableRelays)
    const current = currentResult.deployments
    const definitions = await definitionsPromise
    const currentForStack = current.filter((deployment) => deployment.id === id)
    const definition = definitions.find((candidate) => candidate.id === id)
    const nextDefinition = {
      domain: data.domain,
      id,
      name: data.name,
    }
    if (grouped.size === 0 && !definition && currentForStack.length === 0) {
      throw new Error("Select at least one server to create this network")
    }

    const desired = [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map<DesiredTailscaleDeployment>(([relayId, bindings]) => {
        const relay = relayById.get(relayId)
        if (!relay) throw new Error("A selected server's node is unavailable")
        return {
          bindings: bindings.map(({ hostname, instanceId }) => ({
            hostname,
            instanceId,
          })),
          hostname: deploymentHostname(data.name, relay.name, relay.id),
          relayId,
          relayName: relay.name,
        }
      })
    const synchronized = await applyTailscaleDeploymentPlan({
      authKey: data.authKey,
      current: currentForStack,
      desired,
      domain: data.domain,
      id,
      name: data.name,
      operations: {
        apply: async (target, input) => {
          const relay = relayById.get(target.relayId)
          if (!relay) throw new Error("The network's node is unavailable")
          const stack = relayTailscaleStackSchema.parse(
            await relayRpc(relay, "relay.tailscale.stack.apply", input, 240_000)
          )
          return {
            ...stack,
            relayId: target.relayId,
            relayName: target.relayName,
          }
        },
        remove: async (deployment) => {
          await removeDeployment(deployment, relayById)
        },
        syncDns: async (deployment, records) => {
          const relay = relayById.get(deployment.relayId)
          if (!relay) throw new Error("The network's node is unavailable")
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
        },
      },
    })

    const desiredRelayIds = new Set(grouped.keys())
    const removed = currentForStack.filter(
      ({ relayId }) => !desiredRelayIds.has(relayId)
    )
    await saveTailscaleNetworkDefinition(nextDefinition)
    await invalidateRelaySnapshots([
      ...desiredRelayIds,
      ...removed.map(({ relayId }) => relayId),
    ])
    return {
      stacks: groupTailscaleDeployments(
        [
          ...current.filter((deployment) => deployment.id !== id),
          ...synchronized,
        ],
        replaceTailscaleNetworkDefinition(definitions, nextDefinition)
      ),
      unavailableRelays: [],
    }
  })

export const removeTailscaleStack = createServerFn({ method: "POST" })
  .validator(removeTailscaleStackSchema)
  .handler(async ({ data }) => {
    await requireTailscaleAdministrator()
    const relays = (await listPersistedRelays()).filter(
      (relay) => relay.enabled
    )
    const relayById = new Map(relays.map((relay) => [relay.id, relay]))
    const current = await loadTailscaleDeployments(relays)
    requireCompleteTailscaleDeploymentList(current.unavailableRelays)
    const deployments = current.deployments.filter(
      (deployment) => deployment.id === data.id
    )
    await removeDeployments(deployments, relayById)
    await removeTailscaleNetworkDefinition(data.id)
    await invalidateRelaySnapshots(deployments.map(({ relayId }) => relayId))
    return { removed: true }
  })

async function requireTailscaleAdministrator() {
  const user = await requireAuthenticatedUser()
  if (!isPlatformAdmin(user)) {
    throw new Error("Platform administrator access required")
  }
}

async function loadTailscaleStacks(): Promise<TailscaleStacksResult> {
  const relays = (await listPersistedRelays()).filter((relay) => relay.enabled)
  const [definitions, result] = await Promise.all([
    loadTailscaleNetworkDefinitions(),
    loadTailscaleDeployments(relays),
  ])
  return {
    stacks: groupTailscaleDeployments(result.deployments, definitions),
    unavailableRelays: result.unavailableRelays,
  }
}

function groupTailscaleDeployments(
  deployments: ReadonlyArray<TailscaleDeployment>,
  definitions: ReadonlyArray<TailscaleNetworkDefinition>
): Array<TailscaleStackOverview> {
  const grouped = new Map<string, TailscaleStackOverview>()
  for (const definition of definitions) {
    grouped.set(definition.id, {
      ...definition,
      bindings: [],
      deployments: [],
    })
  }
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
): Promise<{
  deployments: Array<TailscaleDeployment>
  unavailableRelays: TailscaleStacksResult["unavailableRelays"]
}> {
  const results = await Promise.all(
    relays.map(async (relay) => {
      try {
        const stacks = relayTailscaleStacksSchema.parse(
          await relayRpc(relay, "relay.tailscale.stack.list", {}, 5_000)
        )
        return {
          deployments: stacks.map((stack) => ({
            ...stack,
            relayId: relay.id,
            relayName: relay.name,
          })),
          unavailableRelay: null,
        }
      } catch (cause) {
        return {
          deployments: [],
          unavailableRelay: {
            id: relay.id,
            message:
              cause instanceof Error
                ? cause.message
                : "The Relay did not return its Tailscale deployments",
            name: relay.name,
          },
        }
      }
    })
  )
  return {
    deployments: results.flatMap((result) => result.deployments),
    unavailableRelays: results.flatMap((result) =>
      result.unavailableRelay ? [result.unavailableRelay] : []
    ),
  }
}

async function removeDeployments(
  deployments: ReadonlyArray<TailscaleDeployment>,
  relayById: ReadonlyMap<string, PersistedRelay>
): Promise<void> {
  await Promise.all(
    deployments.map((deployment) => removeDeployment(deployment, relayById))
  )
}

async function removeDeployment(
  deployment: Pick<TailscaleDeployment, "id" | "relayId">,
  relayById: ReadonlyMap<string, PersistedRelay>
): Promise<void> {
  const relay = relayById.get(deployment.relayId)
  if (!relay) throw new Error("The network's node is unavailable")
  await relayRpc(
    relay,
    "relay.tailscale.stack.remove",
    { id: deployment.id },
    120_000
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

function loadTailscaleNetworkDefinitions() {
  return runAppEffect(
    "tailscale.networks.load",
    loadTailscaleNetworkDefinitionsEffect()
  )
}

function saveTailscaleNetworkDefinition(
  definition: TailscaleNetworkDefinition
) {
  return runAppEffect(
    "tailscale.networks.save",
    saveTailscaleNetworkDefinitionEffect(definition)
  )
}

function removeTailscaleNetworkDefinition(id: string) {
  return runAppEffect(
    "tailscale.networks.remove",
    removeTailscaleNetworkDefinitionEffect(id)
  )
}

function replaceTailscaleNetworkDefinition(
  definitions: ReadonlyArray<TailscaleNetworkDefinition>,
  next: TailscaleNetworkDefinition
): Array<TailscaleNetworkDefinition> {
  return [
    ...definitions.filter((definition) => definition.id !== next.id),
    next,
  ]
}

function requireCompleteTailscaleDeploymentList(
  unavailableRelays: TailscaleStacksResult["unavailableRelays"]
): void {
  if (unavailableRelays.length === 0) return
  const names = unavailableRelays.map(({ name }) => name).join(", ")
  throw new Error(
    `Tailscale networks cannot be changed until these Relays are available and updated: ${names}`
  )
}
