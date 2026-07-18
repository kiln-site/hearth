export interface RelayInstanceConfig {
  brickId?: "fabric" | "folia" | "paper" | "palworld" | "velocity"
  connectAddress: string
  directory: string
  game: string
  id: string
  shortId: string
  implementation: string
  javaVersion: string
  name: string
  service: string
  version: string
  managedByRelay: boolean
}

export interface RelayConfig {
  composeFile: string
  connectDomain: string
  connectPort: number
  dockerSocket: string
  dataDirectory: string
  host: string
  managedLabel: string
  serverIdLabel: string
  nodeId: string
  nodeName: string
  port: number
  projectDirectory: string
  projectName: string
  rootDirectory: string
  token: string | null
}

export function loadConfig(): RelayConfig {
  return {
    composeFile: "/data/instances/compose.yaml",
    connectDomain: "test",
    connectPort: 25_565,
    dockerSocket: "/var/run/docker.sock",
    dataDirectory: "/data",
    host: "0.0.0.0",
    managedLabel: "kiln.relay.managed=true",
    nodeId: "kiln-relay",
    nodeName: "Local Minecraft node",
    port: relayPort(),
    projectDirectory: "/data/instances",
    projectName: "mc-servers",
    rootDirectory: "/data/instances",
    serverIdLabel: "kiln.server.id",
    token: relayKey(),
  }
}

function relayKey(): string | null {
  const key = process.env.KILN_RELAY_KEY?.trim() || null
  if (!key && process.env.NODE_ENV === "production") {
    throw new Error("KILN_RELAY_KEY is required in production")
  }
  if (key && key.length < 32) {
    throw new Error("KILN_RELAY_KEY must contain at least 32 characters")
  }
  return key
}

function relayPort(): number {
  const configured = process.env.KILN_RELAY_PORT?.trim()
  const port = Number(configured || 4100)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("KILN_RELAY_PORT must be a valid TCP port")
  }
  return port
}
