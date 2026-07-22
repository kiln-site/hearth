import { readFileSync } from "node:fs"
import { hostname } from "node:os"

export interface RelayInstanceConfig {
  brickFormat?: string
  brickId?: string
  brickNetworkMode?: "direct" | "minecraft-backend" | "minecraft-proxy"
  brickPrimaryPort?: number
  brickSource?: string
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

export type RelayTlsMode = "development" | "external" | "managed"

export interface RelayConfig {
  advertisedHost: string
  brickCatalogUrl: string
  bootstrapToken: string | null
  browserOrigin: string
  composeFile: string
  connectDomain: string
  connectPort: number
  dockerSocket: string
  dataDirectory: string
  host: string
  legacyToken: string | null
  managedLabel: string
  serverIdLabel: string
  nodeId: string
  nodeName: string
  port: number
  projectDirectory: string
  projectName: string
  rootDirectory: string
  sftpDevAuthentication: boolean
  sftpPort: number
  tlsCertificatePath: string | null
  tlsKeyPath: string | null
  tlsMode: RelayTlsMode
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env
): RelayConfig {
  const dataDirectory = environment.KILN_RELAY_DATA_DIR?.trim() || "/data"
  const advertisedHost =
    environment.KILN_RELAY_HOST?.trim() || hostname() || "localhost"
  const port = parsePort(environment, "KILN_RELAY_PORT", 4100)
  const tlsMode = relayTlsMode(environment)
  return {
    advertisedHost,
    brickCatalogUrl:
      environment.KILN_BRICKS_CATALOG_URL?.trim() ||
      "https://raw.githubusercontent.com/kiln-site/bricks/main/catalog.yml",
    bootstrapToken: bootstrapToken(environment),
    browserOrigin: `${tlsMode === "development" ? "http" : "https"}://${formatUrlHost(advertisedHost)}:${port}`,
    composeFile: `${dataDirectory}/instances/compose.yaml`,
    connectDomain: "test",
    connectPort: 25_565,
    dockerSocket: "/var/run/docker.sock",
    dataDirectory,
    host: environment.KILN_RELAY_BIND_HOST?.trim() || "0.0.0.0",
    legacyToken: legacyRelayKey(environment),
    managedLabel: "kiln.relay.managed=true",
    nodeId: "kiln-relay",
    nodeName: environment.KILN_RELAY_NAME?.trim() || hostname() || "Kiln Relay",
    port,
    projectDirectory: `${dataDirectory}/instances`,
    projectName: "mc-servers",
    rootDirectory: `${dataDirectory}/instances`,
    serverIdLabel: "kiln.server.id",
    sftpDevAuthentication: sftpDevAuthentication(environment),
    sftpPort: parsePort(environment, "KILN_RELAY_SFTP_PORT", 2022),
    tlsCertificatePath: environment.KILN_RELAY_TLS_CERT_FILE?.trim() || null,
    tlsKeyPath: environment.KILN_RELAY_TLS_KEY_FILE?.trim() || null,
    tlsMode,
  }
}

function bootstrapToken(environment: NodeJS.ProcessEnv): string | null {
  const inline = environment.KILN_RELAY_BOOTSTRAP_TOKEN?.trim()
  const file = environment.KILN_RELAY_BOOTSTRAP_TOKEN_FILE?.trim()
  if (inline && file) {
    throw new Error(
      "Configure only one of KILN_RELAY_BOOTSTRAP_TOKEN or KILN_RELAY_BOOTSTRAP_TOKEN_FILE"
    )
  }
  const value = file ? readFileSync(file, "utf8").trim() : inline
  return highEntropySecret(
    value,
    file ? "Relay bootstrap token file" : "KILN_RELAY_BOOTSTRAP_TOKEN"
  )
}

function legacyRelayKey(environment: NodeJS.ProcessEnv): string | null {
  const key = environment.KILN_RELAY_KEY?.trim() || null
  if (key && key.length < 32) {
    throw new Error("KILN_RELAY_KEY must contain at least 32 characters")
  }
  return key
}

function parsePort(
  environment: NodeJS.ProcessEnv,
  name: string,
  defaultPort: number
): number {
  const configured = environment[name]?.trim()
  const port = Number(configured || defaultPort)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a valid TCP port`)
  }
  return port
}

function relayTlsMode(environment: NodeJS.ProcessEnv): RelayTlsMode {
  const fallback =
    environment.NODE_ENV === "production" ? "managed" : "development"
  const value = environment.KILN_RELAY_TLS_MODE?.trim() || fallback
  if (value !== "development" && value !== "external" && value !== "managed") {
    throw new Error(
      "KILN_RELAY_TLS_MODE must be development, external, or managed"
    )
  }
  if (value === "development" && environment.NODE_ENV === "production") {
    throw new Error("Development Relay TLS cannot be used in production")
  }
  if (
    value === "external" &&
    (!environment.KILN_RELAY_TLS_CERT_FILE?.trim() ||
      !environment.KILN_RELAY_TLS_KEY_FILE?.trim())
  ) {
    throw new Error(
      "External Relay TLS requires KILN_RELAY_TLS_CERT_FILE and KILN_RELAY_TLS_KEY_FILE"
    )
  }
  return value
}

function sftpDevAuthentication(environment: NodeJS.ProcessEnv): boolean {
  const enabled = booleanEnvironment(
    environment.KILN_RELAY_SFTP_DEV_AUTH,
    environment.NODE_ENV !== "production"
  )
  if (enabled && environment.NODE_ENV === "production") {
    throw new Error("Development SFTP authentication cannot run in production")
  }
  return enabled
}

function booleanEnvironment(value: string | undefined, fallback: boolean) {
  if (!value?.trim()) return fallback
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`Expected true or false, received ${value}`)
}

function highEntropySecret(
  value: string | undefined,
  name: string
): string | null {
  const secret = value?.trim() || null
  if (secret && Buffer.byteLength(secret) < 32) {
    throw new Error(`${name} must contain at least 32 bytes`)
  }
  return secret
}

function formatUrlHost(value: string): string {
  return value.includes(":") && !value.startsWith("[") ? `[${value}]` : value
}
