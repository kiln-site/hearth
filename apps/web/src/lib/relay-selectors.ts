import type { RelayInstance, RelaySnapshot } from "@workspace/contracts"

import type { RelayConnection } from "@/lib/query-options"

export type RelayConnectionSummary =
  | Exclude<RelayConnection, { status: "connected" }>
  | Pick<Extract<RelayConnection, { status: "connected" }>, "relay" | "status">

export type SidebarInstance = Pick<
  RelayInstance,
  "id" | "implementation" | "name" | "observedState" | "shortId" | "version"
>

export type InstanceWorkspaceInstance = Pick<
  RelayInstance,
  | "connectAddress"
  | "game"
  | "id"
  | "implementation"
  | "javaVersion"
  | "name"
  | "service"
  | "shortId"
  | "version"
>

export type InstanceRuntime = Pick<
  RelayInstance,
  "id" | "observedState" | "resources" | "startedAt"
>

export function selectRelayConnectionSummary(
  connection: RelayConnection
): RelayConnectionSummary {
  return connection.status === "connected"
    ? { relay: connection.relay, status: connection.status }
    : connection
}

export function selectSidebarInstances(
  snapshot: RelaySnapshot
): Array<SidebarInstance> {
  return snapshot.instances.map((instance) => ({
    id: instance.id,
    implementation: instance.implementation,
    name: instance.name,
    observedState: instance.observedState,
    shortId: instance.shortId,
    version: instance.version,
  }))
}

export function selectInstanceWorkspaceInstance(identifier: string) {
  return (snapshot: RelaySnapshot): InstanceWorkspaceInstance | null => {
    const instance = findRelayInstance(snapshot.instances, identifier)
    if (!instance) return null
    return {
      connectAddress: instance.connectAddress,
      game: instance.game,
      id: instance.id,
      implementation: instance.implementation,
      javaVersion: instance.javaVersion,
      name: instance.name,
      service: instance.service,
      shortId: instance.shortId,
      version: instance.version,
    }
  }
}

export function selectInstanceRuntime(instanceId: string) {
  return (snapshot: RelaySnapshot): InstanceRuntime | null => {
    const instance = snapshot.instances.find((item) => item.id === instanceId)
    return instance
      ? {
          id: instance.id,
          observedState: instance.observedState,
          resources: instance.resources,
          startedAt: instance.startedAt,
        }
      : null
  }
}

export function selectInstanceObservedState(instanceId: string) {
  return (snapshot: RelaySnapshot) =>
    snapshot.instances.find((instance) => instance.id === instanceId)
      ?.observedState ?? null
}

export function findRelayInstance<
  T extends { id: string; name: string; shortId: string },
>(instances: Array<T>, identifier: string | null | undefined): T | undefined {
  if (!identifier) return undefined
  return instances.find(
    (instance) =>
      instance.shortId === identifier ||
      instance.id === identifier ||
      instance.name === identifier
  )
}
