import type { RelayConfig } from "./config.js"

export const RELAY_OWNER_LABEL = "kiln.relay.owner"

export interface RelayResourceNames {
  coreDnsContainer: string
  edgeNetwork: string
  gameNetwork: string
  instanceContainer(instanceId: string): string
  limboContainer: string
  relayEdgeAlias: string
  relayEdgeNetwork: string
  tailscaleContainer: string
  traefikContainer: string
}

export function relayResourceNames(
  config: Pick<RelayConfig, "resourceNamespace">
): RelayResourceNames {
  const name = (legacyName: string): string =>
    config.resourceNamespace
      ? `${config.resourceNamespace}-${legacyName}`
      : legacyName

  return {
    coreDnsContainer: name("kiln-coredns"),
    edgeNetwork: name("kiln-edge"),
    gameNetwork: name("kiln-minecraft"),
    instanceContainer: (instanceId) => name(`kiln-${instanceId.slice(0, 8)}`),
    limboContainer: name("kiln-limbo"),
    relayEdgeAlias: "kiln-relay",
    relayEdgeNetwork: name("kiln-relay-edge"),
    tailscaleContainer: name("kiln-tailscale"),
    traefikContainer: name("kiln-traefik"),
  }
}

export function relayOwnerLabel(
  config: Pick<RelayConfig, "resourceNamespace">
): string | null {
  return config.resourceNamespace
    ? `${RELAY_OWNER_LABEL}=${config.resourceNamespace}`
    : null
}

export function relayOwnsLabels(
  config: Pick<RelayConfig, "resourceNamespace">,
  labels: Readonly<Record<string, string | undefined>> | null
): boolean {
  const owner = labels?.[RELAY_OWNER_LABEL]
  return config.resourceNamespace ? owner === config.resourceNamespace : !owner
}
