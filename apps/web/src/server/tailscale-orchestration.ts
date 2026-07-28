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

interface TailscaleDeploymentOperations<
  TDeployment extends TailscaleDeploymentState,
> {
  apply: (
    target: DesiredTailscaleDeployment,
    input: RelayTailscaleStackApply
  ) => Promise<TDeployment>
  remove: (deployment: TailscaleDeploymentState) => Promise<void>
  syncDns: (
    deployment: TDeployment,
    records: RelayTailscaleStackDns["records"]
  ) => Promise<TDeployment>
}

export async function applyTailscaleDeploymentPlan<
  TDeployment extends TailscaleDeploymentState,
>({
  authKey,
  current,
  desired,
  domain,
  id,
  name,
  operations,
}: {
  authKey?: string
  current: ReadonlyArray<TDeployment>
  desired: ReadonlyArray<DesiredTailscaleDeployment>
  domain: string
  id: string
  name: string
  operations: TailscaleDeploymentOperations<TDeployment>
}): Promise<Array<TDeployment>> {
  const previousByRelay = new Map(
    current.map((deployment) => [deployment.relayId, deployment])
  )
  const desiredRelayIds = new Set(desired.map(({ relayId }) => relayId))
  const removed = current.filter(
    ({ relayId }) => !desiredRelayIds.has(relayId)
  )
  const applied: Array<TDeployment> = []

  try {
    // A later node may reject a one-time key or fail during installation.
    // Applying one node at a time lets us compensate every completed peer.
    await runSequentially(desired, async (target) => {
      const previous = previousByRelay.get(target.relayId)
      const deployment = await operations.apply(target, {
        ...(previous || !authKey ? {} : { authKey }),
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
    const synchronized: Array<TDeployment> = []
    for (const result of syncResults) {
      if (result.status === "rejected") throw result.reason
      synchronized.push(result.value)
    }

    // Keep removals inside the same compensation boundary as applies and DNS.
    // If one fails, the catch below restores every retained node that changed.
    await runSequentially(removed, operations.remove)
    return synchronized
  } catch (cause) {
    const rollbackFailures = await rollbackTailscaleDeploymentPlan(
      current,
      applied,
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
}

async function rollbackTailscaleDeploymentPlan<
  TDeployment extends TailscaleDeploymentState,
>(
  current: ReadonlyArray<TDeployment>,
  applied: ReadonlyArray<TDeployment>,
  operations: TailscaleDeploymentOperations<TDeployment>
): Promise<Array<string>> {
  const previousByRelay = new Map(
    current.map((deployment) => [deployment.relayId, deployment])
  )
  const failures: Array<string> = []

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
        await operations.remove(deployment)
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
