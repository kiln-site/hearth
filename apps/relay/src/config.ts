import { resolve } from "node:path"

export interface RelayInstanceConfig {
  brickId?: "fabric" | "folia" | "paper" | "velocity"
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
  const dataDirectory = resolve(process.env.KILN_RELAY_DATA_DIR ?? "/data")
  const rootDirectory = resolve(
    process.env.RELAY_ROOT ?? `${dataDirectory}/instances`
  )
  const port = Number(process.env.KILN_RELAY_PORT ?? 4100)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("KILN_RELAY_PORT must be a valid TCP port")
  }
  const connectPort = Number(process.env.RELAY_CONNECT_PORT ?? 25_565)
  if (
    !Number.isInteger(connectPort) ||
    connectPort < 1 ||
    connectPort > 65_535
  ) {
    throw new Error("RELAY_CONNECT_PORT must be a valid TCP port")
  }

  return {
    composeFile: resolve(
      process.env.RELAY_COMPOSE_FILE ?? `${rootDirectory}/compose.yaml`
    ),
    connectDomain: process.env.RELAY_CONNECT_DOMAIN ?? "test",
    connectPort,
    dockerSocket: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock",
    dataDirectory,
    host: process.env.RELAY_HOST ?? "0.0.0.0",
    managedLabel:
      process.env.RELAY_MANAGED_LABEL ?? "kiln.relay.managed=true",
    nodeId: process.env.RELAY_NODE_ID ?? "kiln-relay-01",
    nodeName: process.env.RELAY_NODE_NAME ?? "Local Minecraft node",
    port,
    projectDirectory: resolve(
      process.env.RELAY_PROJECT_DIRECTORY ?? rootDirectory
    ),
    projectName: process.env.RELAY_PROJECT_NAME ?? "mc-servers",
    rootDirectory,
    serverIdLabel: process.env.RELAY_SERVER_ID_LABEL ?? "kiln.server.id",
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
