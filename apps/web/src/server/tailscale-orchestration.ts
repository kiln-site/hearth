import type {
  RelayTailscaleStackApply,
  RelayTailscaleStackDns,
} from "@workspace/contracts"

interface TailscaleBindingState {
  address: string
  hostname: string
  instanceId: string
}

export interface TailscaleDeploymentState {
  bindings: Array<TailscaleBindingState>
  domain: string
  hostname: string
  id: string
  name: string
  relayId: string
  relayName: string
}

export interface DesiredTailscaleDeployment {
  bindings: Array<{ hostname: string; instanceId: string }>
  hostname: string
  relayId: string
  relayName: string
}

export type TailscaleRemovalMode = "commit" | "prepare" | "rollback"

export interface TailscaleDeploymentOperations<
  TDeployment extends TailscaleDeploymentState,
> {
  apply: (
    target: DesiredTailscaleDeployment,
    input: RelayTailscaleStackApply
  ) => Promise<TDeployment>
  remove: (
    deployment: TailscaleDeploymentState,
    mode: TailscaleRemovalMode
  ) => Promise<void>
  syncDns: (
    deployment: TDeployment,
    records: RelayTailscaleStackDns["records"]
  ) => Promise<TDeployment>
}

export async function applyTailscaleDeploymentPlan<
  TDeployment extends TailscaleDeploymentState,
>({
  authKey,
  authKeyForTarget,
  current,
  desired,
  domain,
  id,
  name,
  operations,
  beforeFinalize,
}: {
  authKey?: string
  authKeyForTarget?: (
    target: DesiredTailscaleDeployment
  ) => Promise<string | undefined>
  current: ReadonlyArray<TDeployment>
  desired: ReadonlyArray<DesiredTailscaleDeployment>
  domain: string
  id: string
  name: string
  operations: TailscaleDeploymentOperations<TDeployment>
  beforeFinalize?: (deployments: ReadonlyArray<TDeployment>) => Promise<void>
}): Promise<Array<TDeployment>> {
  const previousByRelay = new Map(
    current.map((deployment) => [deployment.relayId, deployment])
  )
  const desiredRelayIds = new Set(desired.map(({ relayId }) => relayId))
  const removed = current.filter(({ relayId }) => !desiredRelayIds.has(relayId))
  const applied: Array<TDeployment> = []
  const preparedRemovals: Array<TDeployment> = []
  let synchronized: Array<TDeployment> = []
  const newTargetCount = desired.filter(
    ({ relayId }) => !previousByRelay.has(relayId)
  ).length
  if (newTargetCount > 1 && !authKeyForTarget) {
    throw new Error(
      "A manual auth key can add one new Relay at a time. Generate a separate key for each Relay."
    )
  }

  try {
    // A later node may reject a one-time key or fail during installation.
    // Applying one node at a time lets us compensate every completed peer.
    await runSequentially(desired, async (target) => {
      const previous = previousByRelay.get(target.relayId)
      const targetAuthKey = previous
        ? undefined
        : authKeyForTarget
          ? await authKeyForTarget(target)
          : authKey
      const deployment = await operations.apply(target, {
        ...(targetAuthKey ? { authKey: targetAuthKey } : {}),
        bindings: target.bindings,
        domain,
        hostname: target.hostname,
        id,
        name,
      })
      applied.push(deployment)
    })

    const records = applied.flatMap((deployment) =>
      deployment.bindings.map(({ address, hostname }) => ({
        address,
        hostname,
      }))
    )
    const syncResults = await Promise.allSettled(
      applied.map((deployment) => operations.syncDns(deployment, records))
    )
    synchronized = []
    for (const result of syncResults) {
      if (result.status === "rejected") throw result.reason
      synchronized.push(result.value)
    }

    // Preparing a removal keeps its identity on disk, so every prepared node
    // can be restored if a later node or control-plane update fails.
    await runSequentially(removed, async (deployment) => {
      preparedRemovals.push(deployment)
      await operations.remove(deployment, "prepare")
    })
    await beforeFinalize?.(synchronized)
  } catch (cause) {
    const rollbackFailures = await rollbackTailscaleDeploymentPlan(
      current,
      applied,
      preparedRemovals,
      operations
    )
    const message =
      cause instanceof Error ? cause.message : "Unknown Tailscale error"
    const rollbackMessage = rollbackFailures.length
      ? ` Rollback also failed: ${rollbackFailures.join("; ")}`
      : ""
    throw new Error(
      `Could not update Tailscale network: ${message}.${rollbackMessage}`,
      {
        cause,
      }
    )
  }

  // Cleanup starts only after the desired state is durable. It is retried and
  // reported separately because rolling back here would disagree with the
  // already-finalized database and Tailscale control plane.
  const cleanupResults = await Promise.allSettled(
    preparedRemovals.map((deployment) =>
      commitRemovalWithRetry(deployment, operations)
    )
  )
  const cleanupFailures = cleanupResults.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          rollbackFailure(
            preparedRemovals[index]?.relayName ?? "Unknown Relay",
            result.reason
          ),
        ]
      : []
  )
  if (cleanupFailures.length > 0) {
    throw new Error(
      `Tailscale network was updated, but Relay cleanup failed after 3 attempts: ${cleanupFailures.join("; ")}. Retry the change to finish cleanup.`
    )
  }
  return synchronized
}

async function commitRemovalWithRetry<
  TDeployment extends TailscaleDeploymentState,
>(
  deployment: TDeployment,
  operations: TailscaleDeploymentOperations<TDeployment>,
  attempt = 1
): Promise<void> {
  try {
    await operations.remove(deployment, "commit")
  } catch (cause) {
    if (attempt >= 3) throw cause
    await commitRemovalWithRetry(deployment, operations, attempt + 1)
  }
}

async function rollbackTailscaleDeploymentPlan<
  TDeployment extends TailscaleDeploymentState,
>(
  current: ReadonlyArray<TDeployment>,
  applied: ReadonlyArray<TDeployment>,
  preparedRemovals: ReadonlyArray<TDeployment>,
  operations: TailscaleDeploymentOperations<TDeployment>
): Promise<Array<string>> {
  const previousByRelay = new Map(
    current.map((deployment) => [deployment.relayId, deployment])
  )
  const failures: Array<string> = []

  const removalRollbacks = [...preparedRemovals].reverse()
  const removalRollbackResults = await Promise.allSettled(
    removalRollbacks.map((deployment) =>
      operations.remove(deployment, "rollback")
    )
  )
  for (const [index, result] of removalRollbackResults.entries()) {
    if (result.status === "rejected") {
      const deployment = removalRollbacks[index]
      failures.push(
        rollbackFailure(deployment?.relayName ?? "Unknown Relay", result.reason)
      )
    }
  }

  const rollbackDeployments = [...applied].reverse()
  const rollbackResults = await Promise.allSettled(
    rollbackDeployments.map(async (deployment) => {
      const previous = previousByRelay.get(deployment.relayId)
      if (previous) {
        await operations.apply(deploymentTarget(previous), {
          bindings: previous.bindings.map(({ hostname, instanceId }) => ({
            hostname,
            instanceId,
          })),
          domain: previous.domain,
          hostname: previous.hostname,
          id: previous.id,
          name: previous.name,
        })
      } else {
        await operations.remove(deployment, "prepare")
        await operations.remove(deployment, "commit")
      }
    })
  )
  for (const [index, result] of rollbackResults.entries()) {
    if (result.status === "rejected") {
      const deployment = rollbackDeployments[index]
      failures.push(
        rollbackFailure(deployment?.relayName ?? "Unknown Relay", result.reason)
      )
    }
  }

  const records = current.flatMap((deployment) =>
    deployment.bindings.map(({ address, hostname }) => ({ address, hostname }))
  )
  const syncResults = await Promise.allSettled(
    current.map((deployment) => operations.syncDns(deployment, records))
  )
  for (const [index, result] of syncResults.entries()) {
    if (result.status === "rejected") {
      const deployment = current[index]
      failures.push(
        rollbackFailure(deployment?.relayName ?? "Unknown Relay", result.reason)
      )
    }
  }
  return failures
}

function deploymentTarget(
  deployment: TailscaleDeploymentState
): DesiredTailscaleDeployment {
  return {
    bindings: deployment.bindings.map(({ hostname, instanceId }) => ({
      hostname,
      instanceId,
    })),
    hostname: deployment.hostname,
    relayId: deployment.relayId,
    relayName: deployment.relayName,
  }
}

function rollbackFailure(relayName: string, cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "unknown error"
  return `${relayName}: ${message}`
}

async function runSequentially<TValue>(
  values: ReadonlyArray<TValue>,
  run: (value: TValue) => Promise<void>,
  index = 0
): Promise<void> {
  const value = values[index]
  if (value === undefined) return
  await run(value)
  return runSequentially(values, run, index + 1)
}
