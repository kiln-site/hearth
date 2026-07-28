import type { RelayInstance, RelayObservedState } from "@workspace/contracts"

import type { RelayFleetSnapshot } from "@/lib/relay-fleet"

export type ServerAction = "start" | "stop" | "restart" | "kill"

export interface PendingPowerAction {
  action: ServerAction
  phase: "starting" | "stopping" | "running" | "stopped" | "failed"
}

const pendingPowerActions = new Map<string, PendingPowerAction>()

export function beginPendingPowerAction(
  relayId: string,
  instanceId: string,
  action: ServerAction
): PendingPowerAction {
  const pending = initialPendingPowerAction(action)
  pendingPowerActions.set(powerActionKey(relayId, instanceId), pending)
  return pending
}

export function finishPendingPowerAction(relayId: string, instanceId: string) {
  pendingPowerActions.delete(powerActionKey(relayId, instanceId))
}

export function reconcilePendingPowerInstance<T extends RelayInstance>(
  relayId: string,
  instance: T
): T {
  const key = powerActionKey(relayId, instance.id)
  const pending = pendingPowerActions.get(key)
  if (!pending) return instance

  const reconciled = reconcilePendingPowerState(pending, instance.observedState)
  pendingPowerActions.set(key, reconciled.pending)
  return reconciled.observedState === instance.observedState
    ? instance
    : { ...instance, observedState: reconciled.observedState }
}

export function reconcilePendingPowerSnapshot(
  snapshot: RelayFleetSnapshot
): RelayFleetSnapshot {
  let changed = false
  const instances = snapshot.instances.map((instance) => {
    const reconciled = reconcilePendingPowerInstance(instance.relayId, instance)
    if (reconciled !== instance) changed = true
    return reconciled
  })
  return changed ? { ...snapshot, instances } : snapshot
}

export function initialPendingPowerAction(
  action: ServerAction
): PendingPowerAction {
  return {
    action,
    phase: action === "start" ? "starting" : "stopping",
  }
}

export function reconcilePendingPowerState(
  pending: PendingPowerAction,
  incoming: RelayObservedState
): {
  pending: PendingPowerAction
  observedState: RelayObservedState
} {
  if (
    pending.phase === "running" ||
    pending.phase === "stopped" ||
    pending.phase === "failed"
  ) {
    return { pending, observedState: pending.phase }
  }

  if (pending.action === "stop" || pending.action === "kill") {
    if (incoming === "stopped" || incoming === "failed") {
      const completed = { ...pending, phase: incoming }
      return { pending: completed, observedState: incoming }
    }
    return { pending, observedState: "stopping" }
  }

  if (pending.action === "start") {
    if (incoming === "running" || incoming === "failed") {
      const completed = { ...pending, phase: incoming }
      return { pending: completed, observedState: incoming }
    }
    return { pending, observedState: "starting" }
  }

  if (pending.phase === "stopping") {
    if (incoming === "starting") {
      const starting = { ...pending, phase: "starting" as const }
      return { pending: starting, observedState: "starting" }
    }
    if (incoming === "failed") {
      const failed = { ...pending, phase: "failed" as const }
      return { pending: failed, observedState: "failed" }
    }
    return { pending, observedState: "stopping" }
  }

  if (incoming === "running" || incoming === "failed") {
    const completed = { ...pending, phase: incoming }
    return { pending: completed, observedState: incoming }
  }
  return { pending, observedState: "starting" }
}

function powerActionKey(relayId: string, instanceId: string) {
  return `${relayId}:${instanceId}`
}
