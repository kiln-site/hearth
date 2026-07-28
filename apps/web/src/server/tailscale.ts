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
  createTailscaleNodeAuthKeyEffect,
  inspectTailscaleControlPlaneEffect,
  syncTailscaleControlPlaneEffect,
  verifyTailscaleOAuthCredentialEffect,
} from "@/effect/tailscale-api"
import {
  loadTailscaleNetworkCredentialEffect,
  loadTailscaleNetworkDefinitionsEffect,
  recordTailscaleNetworkSyncEffect,
  removeTailscaleNetworkDefinitionEffect,
  saveTailscaleNetworkIntegrationEffect,
  saveTailscaleNetworkDefinitionEffect,
  type TailscaleIntegration,
  type TailscaleNetworkDefinition,
  type TailscaleOAuthCredential,
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
  type TailscaleDeploymentOperations,
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

const configureTailscaleIntegrationSchema = z.strictObject({
  clientId: z.string().trim().min(1).max(120),
  clientSecret: z.string().trim().min(20).max(512),
  domain: relayTailscaleDomainSchema,
  id: relayTailscaleStackIdSchema,
  previousDomain: relayTailscaleDomainSchema,
  tag: z
    .string()
    .trim()
    .transform((value) => (value.startsWith("tag:") ? value : `tag:${value}`))
    .pipe(z.string().regex(/^tag:[a-zA-Z0-9][a-zA-Z0-9-]*$/u)),
})

const previewTailscaleIntegrationSchema =
  configureTailscaleIntegrationSchema.omit({ previousDomain: true })

const syncTailscaleIntegrationSchema = z.strictObject({
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
  integration: TailscaleIntegration | null
  name: string
}

export interface TailscaleStacksResult {
  stacks: Array<TailscaleStackOverview>
  unsupportedRelays: Array<{
    id: string
    message: string
    name: string
  }>
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

export const configureTailscaleIntegration = createServerFn({ method: "POST" })
  .validator(configureTailscaleIntegrationSchema)
  .handler(async ({ data }) => {
    await requireTailscaleAdministrator()
    const definitions = await loadTailscaleNetworkDefinitions()
    const definition = definitions.find(({ id }) => id === data.id)
    if (!definition) throw new Error("Tailscale network not found")
    const verified = await runAppEffect(
      "tailscale.oauth.verify",
      verifyTailscaleOAuthCredentialEffect(data.clientId, data.clientSecret, [
        data.tag,
      ])
    )
    await runAppEffect(
      "tailscale.networks.integration.save",
      saveTailscaleNetworkIntegrationEffect(
        data.id,
        verified,
        data.clientSecret
      )
    )
    const credential = {
      ...verified,
      clientSecret: data.clientSecret,
    } satisfies TailscaleOAuthCredential
    try {
      const result = await loadTailscaleStacks()
      requireCompleteTailscaleDeploymentList(result.unavailableRelays)
      const stack = result.stacks.find(({ id }) => id === data.id)
      if (!stack) throw new Error("Tailscale network not found")
      if (stack.domain !== data.domain) {
        throw new Error("The network domain changed before setup completed")
      }
      await synchronizeTailscaleControlPlane(credential, {
        ...stack,
        previousDomain: data.previousDomain,
      })
      const inspection = await inspectTailscaleControlPlane(
        credential,
        stack,
        data.previousDomain
      )
      return {
        inspection,
        stacks: await loadTailscaleStacks(),
      }
    } catch (cause) {
      await recordTailscaleSync(data.id, errorMessage(cause))
      throw cause
    }
  })

export const previewTailscaleIntegration = createServerFn({ method: "POST" })
  .validator(previewTailscaleIntegrationSchema)
  .handler(async ({ data }) => {
    await requireTailscaleAdministrator()
    const result = await loadTailscaleStacks()
    requireCompleteTailscaleDeploymentList(result.unavailableRelays)
    const stack = result.stacks.find(({ id }) => id === data.id)
    if (!stack) throw new Error("Tailscale network not found")
    const verified = await runAppEffect(
      "tailscale.oauth.verify",
      verifyTailscaleOAuthCredentialEffect(data.clientId, data.clientSecret, [
        data.tag,
      ])
    )
    const credential = {
      ...verified,
      clientSecret: data.clientSecret,
    } satisfies TailscaleOAuthCredential
    return {
      credential: verified,
      inspection: await inspectTailscaleControlPlane(
        credential,
        { ...stack, domain: data.domain },
        stack.domain
      ),
    }
  })

export const getTailscaleIntegrationStatus = createServerFn({ method: "POST" })
  .validator(syncTailscaleIntegrationSchema)
  .handler(async ({ data }) => {
    await requireTailscaleAdministrator()
    const [credential, result] = await Promise.all([
      loadTailscaleNetworkCredential(data.id),
      loadTailscaleStacks(),
    ])
    requireCompleteTailscaleDeploymentList(result.unavailableRelays)
    const stack = result.stacks.find(({ id }) => id === data.id)
    if (!stack) throw new Error("Tailscale network not found")
    return {
      inspection: await inspectTailscaleControlPlane(credential, stack),
      stacks: result,
    }
  })

export const syncTailscaleIntegration = createServerFn({ method: "POST" })
  .validator(syncTailscaleIntegrationSchema)
  .handler(async ({ data }) => {
    await requireTailscaleAdministrator()
    const [credential, result] = await Promise.all([
      loadTailscaleNetworkCredential(data.id),
      loadTailscaleStacks(),
    ])
    requireCompleteTailscaleDeploymentList(result.unavailableRelays)
    const stack = result.stacks.find(({ id }) => id === data.id)
    if (!stack) throw new Error("Tailscale network not found")
    try {
      await synchronizeTailscaleControlPlane(credential, stack)
      return loadTailscaleStacks()
    } catch (cause) {
      await recordTailscaleSync(data.id, errorMessage(cause))
      throw cause
    }
  })

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

    const [currentResult, definitions] = await Promise.all([
      loadTailscaleDeployments(relays),
      loadTailscaleNetworkDefinitions(),
    ])
    const current = currentResult.deployments
    const currentForStack = current.filter((deployment) => deployment.id === id)
    const definition = definitions.find((candidate) => candidate.id === id)
    const currentRelayIds = new Set(
      currentForStack.map(({ relayId }) => relayId)
    )
    const domainOwner = definitions.find(
      (candidate) => candidate.id !== id && candidate.domain === data.domain
    )
    if (domainOwner) {
      throw new Error(
        `Network TLD .${data.domain} is already used by ${domainOwner.name}`
      )
    }
    if (definition || currentForStack.length > 0) {
      requireCompleteTailscaleDeploymentList(currentResult.unavailableRelays)
    }
    for (const binding of data.bindings) {
      const snapshot = currentResult.snapshots.get(binding.relayId)
      if (!snapshot) {
        throw new Error("A selected server's node is unavailable")
      }
      if (!relaySupportsTailscaleStacks(snapshot)) {
        const relay = relayById.get(binding.relayId)
        throw new Error(
          `${relay?.name ?? "This Relay"} must be updated before its servers can join a Tailscale network`
        )
      }
      if (
        !currentRelayIds.has(binding.relayId) &&
        !relaySupportsTailscaleStagedRemoval(snapshot)
      ) {
        const relay = relayById.get(binding.relayId)
        throw new Error(
          `${relay?.name ?? "This Relay"} must be updated before its servers can join a Tailscale network`
        )
      }
      const instance = snapshot.instances.find(
        (candidate) => candidate.id === binding.instanceId
      )
      if (!instance || !instance.managedByRelay) {
        throw new Error(
          `Server ${binding.instanceId.slice(0, 8)} is unavailable`
        )
      }
      if (instance.brickId === builtinTailscaleBrickId) {
        throw new Error("A Tailscale deployment cannot attach to itself")
      }
    }

    const nextDefinition = {
      domain: data.domain,
      id,
      integration: definition?.integration ?? null,
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
    const integrationCredential = definition?.integration
      ? await loadTailscaleNetworkCredential(id)
      : null
    const newTargets = desired.filter(
      ({ relayId }) => !currentRelayIds.has(relayId)
    )
    if (newTargets.length > 1 && !integrationCredential) {
      throw new Error(
        "A manual auth key can add one new Relay at a time. Install the first Relay, connect Kiln to Tailscale, then add the remaining Relays."
      )
    }
    const desiredRelayIds = new Set(grouped.keys())
    const removed = currentForStack.filter(
      ({ relayId }) => !desiredRelayIds.has(relayId)
    )
    requireStagedRemovalSupport(removed, currentResult.snapshots, relayById)
    const synchronized = await applyTailscaleDeploymentPlan({
      authKey: data.authKey,
      authKeyForTarget: integrationCredential
        ? async (target) =>
            createTailscaleNodeAuthKey(integrationCredential, target.hostname)
        : undefined,
      current: currentForStack,
      desired,
      domain: data.domain,
      id,
      name: data.name,
      operations: tailscaleDeploymentOperations(id, relayById),
      beforeFinalize: async (deployments) => {
        if (integrationCredential && definition?.integration) {
          try {
            await synchronizeTailscaleControlPlane(
              integrationCredential,
              tailscaleOverviewForDeployments(
                nextDefinition,
                deployments,
                definition.domain
              )
            )
            nextDefinition.integration = {
              ...definition.integration,
              lastError: null,
              lastSyncedAt: new Date().toISOString(),
            }
          } catch (cause) {
            const message = errorMessage(cause)
            await recordTailscaleSync(id, message)
            await restoreTailscaleControlPlane(
              integrationCredential,
              definition,
              currentForStack
            )
            throw cause
          }
        }
        try {
          await saveTailscaleNetworkDefinition(nextDefinition)
        } catch (cause) {
          let domainOwnerAfterConflict: TailscaleNetworkDefinition | null = null
          try {
            if (integrationCredential && definition) {
              await restoreTailscaleControlPlane(
                integrationCredential,
                definition,
                currentForStack
              )
            }
            if (
              integrationCredential &&
              definition?.domain !== nextDefinition.domain
            ) {
              domainOwnerAfterConflict =
                await reconcileTailscaleDomainAfterDefinitionFailure(
                  integrationCredential,
                  nextDefinition,
                  relays
                )
            }
          } catch (recoveryCause) {
            throw new Error(
              `${errorMessage(cause)}. Tailscale DNS recovery also failed: ${errorMessage(recoveryCause)}`,
              { cause: recoveryCause }
            )
          }
          if (domainOwnerAfterConflict) {
            throw new Error(
              `Network TLD .${nextDefinition.domain} is already used by ${domainOwnerAfterConflict.name}`,
              { cause }
            )
          }
          throw cause
        }
      },
    })

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
      unavailableRelays: currentResult.unavailableRelays,
      unsupportedRelays: currentResult.unsupportedRelays,
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
    const [current, definitions] = await Promise.all([
      loadTailscaleDeployments(relays),
      loadTailscaleNetworkDefinitions(),
    ])
    requireCompleteTailscaleDeploymentList(current.unavailableRelays)
    const deployments = current.deployments.filter(
      (deployment) => deployment.id === data.id
    )
    requireStagedRemovalSupport(deployments, current.snapshots, relayById)
    const definition = definitions.find(({ id }) => id === data.id)
    const credential = definition?.integration
      ? await loadTailscaleNetworkCredential(data.id)
      : null
    const fallback = deployments[0]
    await applyTailscaleDeploymentPlan({
      current: deployments,
      desired: [],
      domain: definition?.domain ?? fallback?.domain ?? "test",
      id: data.id,
      name: definition?.name ?? fallback?.name ?? "Tailscale network",
      operations: tailscaleDeploymentOperations(data.id, relayById),
      beforeFinalize: async () => {
        if (credential && definition) {
          try {
            await synchronizeTailscaleControlPlane(
              credential,
              tailscaleOverviewForDeployments(definition, [])
            )
          } catch (cause) {
            await recordTailscaleSync(data.id, errorMessage(cause))
            throw cause
          }
        }
        try {
          await removeTailscaleNetworkDefinition(data.id)
        } catch (cause) {
          if (credential && definition) {
            await restoreTailscaleControlPlane(
              credential,
              definition,
              deployments
            )
          }
          throw cause
        }
      },
    })
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
    unsupportedRelays: result.unsupportedRelays,
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
      integration: null,
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
  snapshots: Map<string, RelaySnapshot>
  unsupportedRelays: TailscaleStacksResult["unsupportedRelays"]
  unavailableRelays: TailscaleStacksResult["unavailableRelays"]
}> {
  const results = await Promise.all(
    relays.map(async (relay) => {
      try {
        const snapshot = relaySnapshotSchema.parse(
          await relayRpc(relay, "relay.snapshot", {}, 5_000)
        )
        if (!relaySupportsTailscaleStacks(snapshot)) {
          return {
            deployments: [],
            relayId: relay.id,
            snapshot,
            unavailableRelay: null,
            unsupportedRelay: {
              id: relay.id,
              message: "Update this Relay before changing Tailscale memberships",
              name: relay.name,
            },
          }
        }
        const stacks = relayTailscaleStacksSchema.parse(
          await relayRpc(relay, "relay.tailscale.stack.list", {}, 5_000)
        )
        return {
          deployments: stacks.map((stack) => ({
            ...stack,
            relayId: relay.id,
            relayName: relay.name,
          })),
          relayId: relay.id,
          snapshot,
          unavailableRelay: null,
          unsupportedRelay: relaySupportsTailscaleStagedRemoval(snapshot)
            ? null
            : {
                id: relay.id,
                message:
                  "Update this Relay before changing Tailscale memberships",
                name: relay.name,
              },
        }
      } catch (cause) {
        return {
          deployments: [],
          relayId: relay.id,
          snapshot: null,
          unavailableRelay: {
            id: relay.id,
            message:
              cause instanceof Error
                ? cause.message
                : "The Relay did not return its Tailscale deployments",
            name: relay.name,
          },
          unsupportedRelay: null,
        }
      }
    })
  )
  const snapshots = new Map<string, RelaySnapshot>()
  for (const result of results) {
    if (result.snapshot) snapshots.set(result.relayId, result.snapshot)
  }
  return {
    deployments: results.flatMap((result) => result.deployments),
    snapshots,
    unsupportedRelays: results.flatMap((result) =>
      result.unsupportedRelay ? [result.unsupportedRelay] : []
    ),
    unavailableRelays: results.flatMap((result) =>
      result.unavailableRelay ? [result.unavailableRelay] : []
    ),
  }
}

function tailscaleDeploymentOperations(
  id: string,
  relayById: ReadonlyMap<string, PersistedRelay>
): TailscaleDeploymentOperations<TailscaleDeployment> {
  return {
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
    remove: async (deployment, mode) => {
      await removeDeployment(deployment, relayById, mode)
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
  }
}

async function removeDeployment(
  deployment: Pick<TailscaleDeployment, "id" | "relayId">,
  relayById: ReadonlyMap<string, PersistedRelay>,
  mode: "commit" | "prepare" | "rollback"
): Promise<void> {
  const relay = relayById.get(deployment.relayId)
  if (!relay) throw new Error("The network's node is unavailable")
  await relayRpc(
    relay,
    "relay.tailscale.stack.remove",
    { id: deployment.id, mode },
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

function loadTailscaleNetworkCredential(id: string) {
  return runAppEffect(
    "tailscale.networks.integration.load",
    loadTailscaleNetworkCredentialEffect(id)
  )
}

function createTailscaleNodeAuthKey(
  credential: TailscaleOAuthCredential,
  nodeName: string
) {
  return runAppEffect(
    "tailscale.authKey.create",
    createTailscaleNodeAuthKeyEffect(credential, nodeName)
  )
}

async function synchronizeTailscaleControlPlane(
  credential: TailscaleOAuthCredential,
  stack: TailscaleStackOverview & { previousDomain?: string }
) {
  const result = await runAppEffect(
    "tailscale.controlPlane.sync",
    syncTailscaleControlPlaneEffect(credential, stack)
  )
  await recordTailscaleSync(stack.id, null)
  return result
}

function inspectTailscaleControlPlane(
  credential: TailscaleOAuthCredential,
  stack: TailscaleStackOverview,
  previousDomain?: string
) {
  return runAppEffect(
    "tailscale.controlPlane.inspect",
    inspectTailscaleControlPlaneEffect(credential, {
      ...stack,
      previousDomain,
    })
  )
}

function recordTailscaleSync(id: string, error: string | null) {
  return runAppEffect(
    "tailscale.networks.integration.recordSync",
    recordTailscaleNetworkSyncEffect(id, error)
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
    `Tailscale networks cannot be changed while these Relays are unavailable: ${names}`
  )
}

function relaySupportsTailscaleStacks(snapshot: RelaySnapshot): boolean {
  return snapshot.node.capabilities.includes("tailscale-stacks")
}

function relaySupportsTailscaleStagedRemoval(snapshot: RelaySnapshot): boolean {
  return snapshot.node.capabilities.includes("tailscale-staged-removal")
}

function requireStagedRemovalSupport(
  deployments: ReadonlyArray<TailscaleDeployment>,
  snapshots: ReadonlyMap<string, RelaySnapshot>,
  relayById: ReadonlyMap<string, PersistedRelay>
): void {
  const unsupported = deployments.filter((deployment) => {
    const snapshot = snapshots.get(deployment.relayId)
    return !snapshot || !relaySupportsTailscaleStagedRemoval(snapshot)
  })
  if (unsupported.length === 0) return
  const names = [
    ...new Set(
      unsupported.map(
        ({ relayId, relayName }) => relayById.get(relayId)?.name ?? relayName
      )
    ),
  ].join(", ")
  throw new Error(
    `Update these Relays before removing them from Tailscale: ${names}`
  )
}

function tailscaleOverviewForDeployments(
  definition: TailscaleNetworkDefinition,
  deployments: ReadonlyArray<TailscaleDeployment>,
  previousDomain?: string
): TailscaleStackOverview & { previousDomain?: string } {
  return {
    ...definition,
    bindings: deployments.flatMap(({ bindings, relayId, relayName }) =>
      bindings.map((binding) => ({
        ...binding,
        relayId,
        relayName,
      }))
    ),
    deployments: [...deployments],
    ...(previousDomain ? { previousDomain } : {}),
  }
}

async function restoreTailscaleControlPlane(
  credential: TailscaleOAuthCredential,
  definition: TailscaleNetworkDefinition,
  deployments: ReadonlyArray<TailscaleDeployment>
): Promise<void> {
  await runAppEffect(
    "tailscale.controlPlane.restore",
    syncTailscaleControlPlaneEffect(
      credential,
      tailscaleOverviewForDeployments(definition, deployments)
    )
  )
}

async function reconcileTailscaleDomainAfterDefinitionFailure(
  credential: TailscaleOAuthCredential,
  failedDefinition: TailscaleNetworkDefinition,
  relays: ReadonlyArray<PersistedRelay>
): Promise<TailscaleNetworkDefinition | null> {
  // The losing request may already have replaced this split-DNS entry. Clear
  // it on that tailnet before restoring whichever network actually won the
  // database uniqueness race.
  await runAppEffect(
    "tailscale.controlPlane.domain.clearAfterDefinitionFailure",
    syncTailscaleControlPlaneEffect(
      credential,
      tailscaleOverviewForDeployments(failedDefinition, [])
    )
  )

  const [definitions, current] = await Promise.all([
    loadTailscaleNetworkDefinitions(),
    loadTailscaleDeployments(relays),
  ])
  requireCompleteTailscaleDeploymentList(current.unavailableRelays)
  const owner =
    definitions.find(
      (definition) =>
        definition.id !== failedDefinition.id &&
        definition.domain === failedDefinition.domain
    ) ?? null
  if (!owner) return null

  const ownerCredential = owner.integration
    ? await loadTailscaleNetworkCredential(owner.id)
    : credential
  await synchronizeTailscaleControlPlane(
    ownerCredential,
    tailscaleOverviewForDeployments(
      owner,
      current.deployments.filter(
        (deployment) => deployment.id === owner.id
      )
    )
  )
  return owner
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Tailscale setup failed"
}
