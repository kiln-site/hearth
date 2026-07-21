import type { RelayInstance, RelayNode } from "@workspace/contracts"

export type RelayReachability = "connected" | "unreachable"

export interface FleetRelayInstance extends RelayInstance {
  relayId: string
  relayName: string
  relayStatus: RelayReachability
  routeId: string
}

export interface FleetRelayNode extends RelayNode {
  relayId: string
  relayName: string
  relayStatus: RelayReachability
}

export interface RelayFleetSnapshot {
  instances: Array<FleetRelayInstance>
  nodes: Array<FleetRelayNode>
}

export function relayInstanceRouteId(relayId: string, shortId: string): string {
  return `${relayId}-${shortId}`
}
