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

export type ServerListInstance = Pick<
  RelayInstance,
  | "connectAddress"
  | "game"
  | "id"
  | "implementation"
  | "name"
  | "observedState"
  | "shortId"
  | "version"
> & {
  relayId: string
  relayName: string
  relayStatus: "connected" | "unreachable"
  routeId: string
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

export function selectSidebarInstanceCount(
  snapshot: RelayFleetSnapshot
): number {
  return snapshot.instances.length
}

export function selectRouteInstances(
  snapshot: RelayFleetSnapshot
): Array<RouteInstance> {
  return snapshot.instances.map((instance) => ({
    ...sidebarInstance(instance),
    relayStatus: instance.relayStatus,
  }))
}

export function selectServerListInstances(
  snapshot: RelayFleetSnapshot
): Array<ServerListInstance> {
  return snapshot.instances.map((instance) => ({
    connectAddress: instance.connectAddress,
    game: instance.game,
    id: instance.id,
    implementation: instance.implementation,
    name: instance.name,
    observedState: instance.observedState,
    relayId: instance.relayId,
    relayName: instance.relayName,
    relayStatus: instance.relayStatus,
    routeId: instance.routeId,
    shortId: instance.shortId,
    version: instance.version,
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

export function selectRelayConfigured(connection: RelayConnection): boolean {
  return connection.status !== "unconfigured" && connection.status !== "paused"
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
  const resolution = resolveRelayInstance(instances, identifier)
  return resolution.status === "found" ? resolution.instance : undefined
}

export type RelayInstanceResolution<T> =
  | { status: "ambiguous" }
  | { status: "found"; instance: T }
  | { status: "not-found" }

export function resolveRelayInstance<
  T extends { id: string; name: string; routeId?: string; shortId: string },
>(
  instances: Array<T>,
  identifier: string | null | undefined
): RelayInstanceResolution<T> {
  if (!identifier) return { status: "not-found" }
  if (/^[a-f0-9]{8}$/u.test(identifier)) {
    return resolveRelayInstanceMatches(
      instances.filter((instance) => instance.shortId === identifier)
    )
  }

  const routeIdMatches = instances.filter(
    (instance) => instance.routeId === identifier
  )
  if (routeIdMatches.length > 0) {
    return resolveRelayInstanceMatches(routeIdMatches)
  }

  const idMatches = instances.filter((instance) => instance.id === identifier)
  if (idMatches.length > 0) return resolveRelayInstanceMatches(idMatches)

  return resolveRelayInstanceMatches(
    instances.filter((instance) => instance.name === identifier)
  )
}

export function resolveCanonicalRelayInstance<
  T extends { id: string; name: string; routeId?: string; shortId: string },
>(
  instances: Array<T>,
  identifier: string | null | undefined
): RelayInstanceResolution<T> {
  const resolution = resolveRelayInstance(instances, identifier)
  if (resolution.status !== "found") return resolution

  const canonicalResolution = resolveRelayInstance(
    instances,
    resolution.instance.shortId
  )
  return canonicalResolution.status === "found"
    ? resolution
    : canonicalResolution
}

export function findFirstCanonicalRelayInstance<T extends { shortId: string }>(
  instances: Array<T>
): T | undefined {
  const shortIdCounts = new Map<string, number>()
  for (const instance of instances) {
    shortIdCounts.set(
      instance.shortId,
      (shortIdCounts.get(instance.shortId) ?? 0) + 1
    )
  }
  return instances.find((instance) => shortIdCounts.get(instance.shortId) === 1)
}

function resolveRelayInstanceMatches<T>(
  matches: Array<T>
): RelayInstanceResolution<T> {
  if (matches.length === 0) return { status: "not-found" }
  const instance = matches[0]
  return matches.length === 1 && instance
    ? { status: "found", instance }
    : { status: "ambiguous" }
}
