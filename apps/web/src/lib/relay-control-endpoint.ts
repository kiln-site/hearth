export interface RelayEndpoint {
  hostname: string
  id: string
  managedTls?: boolean
  port: number
  useTls: boolean
}

export function relayControlEndpoint(
  relay: RelayEndpoint,
  environment: NodeJS.ProcessEnv = process.env
): RelayEndpoint {
  const initializedHostname = environment.KILN_RELAY_HOST?.trim()
  if (!initializedHostname || relay.hostname !== initializedHostname) {
    return relay
  }

  const configured = environment.KILN_RELAY_CONTROL_URL?.trim()
  if (configured) {
    const url = new URL(configured)
    if (
      (url.protocol !== "ws:" && url.protocol !== "wss:") ||
      (url.pathname !== "/" && url.pathname !== "/v1/socket") ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new Error(
        "KILN_RELAY_CONTROL_URL must be a WS/WSS origin or /v1/socket URL without credentials, query, or fragment"
      )
    }
    return {
      ...relay,
      hostname: url.hostname,
      port: effectiveWebSocketPort(url),
      useTls: url.protocol === "wss:",
    }
  }
  if (!relay.managedTls) return relay

  const port = Number(environment.KILN_RELAY_PORT?.trim() || 4100)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("KILN_RELAY_PORT must be a valid TCP port")
  }
  return {
    ...relay,
    hostname: initializedHostname,
    port,
    useTls: true,
  }
}

function effectiveWebSocketPort(url: URL): number {
  if (url.port) return Number(url.port)
  return url.protocol === "wss:" ? 443 : 80
}
