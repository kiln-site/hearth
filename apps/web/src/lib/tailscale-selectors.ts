import { builtinTailscaleBrickId } from "@workspace/contracts"

import type { FleetRelayInstance, RelayFleetSnapshot } from "@/lib/relay-fleet"

export type TailscaleServer = Pick<
  FleetRelayInstance,
  | "id"
  | "implementation"
  | "name"
  | "relayId"
  | "relayName"
  | "routeId"
  | "shortId"
>

export function selectTailscaleServers(
  snapshot: RelayFleetSnapshot
): Array<TailscaleServer> {
  return snapshot.instances
    .flatMap((instance) =>
      instance.brickId === builtinTailscaleBrickId
        ? []
        : [
            {
              id: instance.id,
              implementation: instance.implementation,
              name: instance.name,
              relayId: instance.relayId,
              relayName: instance.relayName,
              routeId: instance.routeId,
              shortId: instance.shortId,
            },
          ]
    )
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function defaultTailscaleHostname(server: TailscaleServer): string {
  const slug = server.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
  return slug || server.shortId
}

export function tailscaleServerKey(
  relayId: string,
  instanceId: string
): string {
  return `${relayId}:${instanceId}`
}
