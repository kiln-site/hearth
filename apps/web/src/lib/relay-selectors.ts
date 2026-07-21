import type { RelayInstance, RelayNode } from "@workspace/contracts"

import type { RelayConnection } from "@/lib/query-options"
import type { RelayFleetSnapshot } from "@/lib/relay-fleet"

export type RelayConnectionSummary =
  | Exclude<RelayConnection, { status: "connected" }>
  | Pick<
      Extract<RelayConnection, { status: "connected" }>,
      "relay" | "relays" | "status"
    >

export type SidebarInstance = Pick<
  RelayInstance,
  "id" | "implementation" | "name" | "observedState" | "shortId" | "version"
> & {
  relayId: string
  relayName: string
  routeId: string
}

export type RouteInstance = SidebarInstance & {
  relayStatus: "connected" | "unreachable"
}

export interface RelaySidebarIdentity {
  configured: boolean
  relayCount: number
  relayName?: string
}

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
> & {
  relayId: string
  relayName: string
  routeId: string
}

export type InstanceRuntime = Pick<
  RelayInstance,
  "id" | "observedState" | "resources" | "startedAt"
> & { relayId: string }

export type InstanceSettingsInstance = Pick<
  RelayInstance,
  | "connectAddress"
  | "containerId"
  | "directory"
  | "game"
  | "id"
  | "implementation"
  | "javaVersion"
  | "name"
  | "service"
  | "shortId"
  | "version"
> & { relayId: string }

export type RelayNodeSummary = Pick<RelayNode, "id" | "name">

export interface InstanceSettingsData {
  instance: InstanceSettingsInstance
  node: RelayNodeSummary
}

export function selectRelayConnectionSummary(
  connection: RelayConnection
): RelayConnectionSummary {
  return connection.status === "connected"
    ? {
        relay: connection.relay,
        relays: connection.relays,
        status: connection.status,
      }
    : connection
}

export function selectSidebarInstances(
  snapshot: RelayFleetSnapshot
): Array<SidebarInstance> {
  return snapshot.instances.map(sidebarInstance)
}

export function selectRouteInstances(
  snapshot: RelayFleetSnapshot
): Array<RouteInstance> {
  return snapshot.instances.map((instance) => ({
    ...sidebarInstance(instance),
    relayStatus: instance.relayStatus,
  }))
}

function sidebarInstance(
  instance: RelayFleetSnapshot["instances"][number]
): SidebarInstance {
  return {
    id: instance.id,
    implementation: instance.implementation,
    name: instance.name,
    observedState: instance.observedState,
    relayId: instance.relayId,
    relayName: instance.relayName,
    routeId: instance.routeId,
    shortId: instance.shortId,
    version: instance.version,
  }
}

export function selectRelaySidebarIdentity(
  connection: RelayConnection
): RelaySidebarIdentity {
  return {
    configured: connection.status !== "unconfigured",
    relayCount: connection.relays?.length ?? (connection.relay ? 1 : 0),
    relayName: connection.relay?.name,
  }
}

export function selectRelayConnected(relayId: string) {
  return (connection: RelayConnection): boolean =>
    connection.status === "connected" &&
    (connection.relays.some(
      (relay) => relay.id === relayId && relay.status === "connected"
    ) ||
      (connection.relays.length === 0 && connection.relay?.id === relayId))
}

export function selectInstanceWorkspaceInstance(identifier: string) {
  return (snapshot: RelayFleetSnapshot): InstanceWorkspaceInstance | null => {
    const instance = findRelayInstance(snapshot.instances, identifier)
    if (!instance) return null
    return {
      connectAddress: instance.connectAddress,
      game: instance.game,
      id: instance.id,
      implementation: instance.implementation,
      javaVersion: instance.javaVersion,
      name: instance.name,
      relayId: instance.relayId,
      relayName: instance.relayName,
      routeId: instance.routeId,
      service: instance.service,
      shortId: instance.shortId,
      version: instance.version,
    }
  }
}

export function selectInstanceRelayConnected(
  identifier: string,
  relayId?: string
) {
  return (snapshot: RelayFleetSnapshot): boolean =>
    snapshot.instances.find(
      (instance) =>
        (!relayId || instance.relayId === relayId) &&
        (instance.routeId === identifier ||
          instance.shortId === identifier ||
          instance.id === identifier ||
          instance.name === identifier)
    )?.relayStatus === "connected"
}

export function selectInstanceRuntime(instanceId: string, relayId?: string) {
  return (snapshot: RelayFleetSnapshot): InstanceRuntime | null => {
    const instance = snapshot.instances.find(
      (item) => item.id === instanceId && (!relayId || item.relayId === relayId)
    )
    return instance
      ? {
          id: instance.id,
          observedState: instance.observedState,
          relayId: instance.relayId,
          resources: instance.resources,
          startedAt: instance.startedAt,
        }
      : null
  }
}

export function selectInstanceSettings(instanceId: string, relayId?: string) {
  return (snapshot: RelayFleetSnapshot): InstanceSettingsData | null => {
    const instance = snapshot.instances.find(
      (item) => item.id === instanceId && (!relayId || item.relayId === relayId)
    )
    if (!instance) return null
    return {
      instance: {
        connectAddress: instance.connectAddress,
        containerId: instance.containerId,
        directory: instance.directory,
        game: instance.game,
        id: instance.id,
        implementation: instance.implementation,
        javaVersion: instance.javaVersion,
        name: instance.name,
        relayId: instance.relayId,
        service: instance.service,
        shortId: instance.shortId,
        version: instance.version,
      },
      node: (() => {
        const node = snapshot.nodes.find(
          (item) => item.relayId === instance.relayId
        )
        return {
          id: node?.id ?? instance.relayId,
          name: node?.name ?? instance.relayName,
        }
      })(),
    }
  }
}

export function selectInstanceObservedState(
  instanceId: string,
  relayId?: string
) {
  return (snapshot: RelayFleetSnapshot) =>
    snapshot.instances.find(
      (instance) =>
        instance.id === instanceId && (!relayId || instance.relayId === relayId)
    )?.observedState ?? null
}

export function findRelayInstance<
  T extends { id: string; name: string; routeId?: string; shortId: string },
>(instances: Array<T>, identifier: string | null | undefined): T | undefined {
  if (!identifier) return undefined
  return instances.find(
    (instance) =>
      instance.routeId === identifier ||
      instance.shortId === identifier ||
      instance.id === identifier ||
      instance.name === identifier
  )
}
