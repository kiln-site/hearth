import { readFileSync } from "node:fs"
import { Resolver } from "node:dns/promises"
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
  variables?: Record<string, boolean | number | string>
  version: string
  managedByRelay: boolean
}

export type RelayTlsMode = "development" | "external" | "managed"
export type RelayProxyMode = "coolify" | "hearth" | "none" | "traefik"

export interface RelayConfig {
  advertisedHost: string
  advertisedHostInferred: boolean
  brickCatalogUrl: string
  bootstrapToken: string | null
  browserOrigin: string
  coolifyPublicOrigin: string | null
  composeFile: string
  connectDomain: string
  connectPort: number
  directBrowserOrigin: string
  directPublicPort: number
  dockerSocket: string
  dataDirectory: string
  host: string
  managedLabel: string
  serverIdLabel: string
  nodeId: string
  nodeName: string
  port: number
  publicPort: number
  projectDirectory: string
  projectName: string
  proxyMode: RelayProxyMode
  rootDirectory: string
  sftpDevAuthentication: boolean
  sftpPort: number
  tlsCertificatePath: string | null
  tlsKeyPath: string | null
  tlsMode: RelayTlsMode
  traefikAcmeEmail: string | null
  traefikImage: string
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env
): RelayConfig {
  const dataDirectory = environment.KILN_RELAY_DATA_DIR?.trim() || "/data"
  const proxyMode = relayProxyMode(environment)
  const port = parsePort(environment, "KILN_RELAY_PORT", 4100)
  const coolifyPublicOrigin = relayCoolifyPublicOrigin(environment, port)
  if (
    proxyMode === "coolify" &&
    !coolifyPublicOrigin &&
    !environment.KILN_RELAY_HOST?.trim()
  ) {
    throw new Error(
      "Coolify proxy mode requires KILN_RELAY_HOST or a Coolify-provided public URL"
    )
  }
  const advertisedHost =
    environment.KILN_RELAY_HOST?.trim() ||
    (coolifyPublicOrigin ? new URL(coolifyPublicOrigin).hostname : null) ||
    hostname() ||
    "localhost"
  const directPublicPort = parsePort(
    environment,
    "KILN_RELAY_PUBLIC_PORT",
    port
  )
  const publicPort =
    proxyMode === "traefik" || proxyMode === "coolify"
      ? coolifyPublicOrigin
        ? effectiveUrlPort(new URL(coolifyPublicOrigin))
        : 443
      : directPublicPort
  const tlsMode = relayTlsMode(environment)
  const directBrowserOrigin = relayBrowserOrigin(
    tlsMode,
    advertisedHost,
    directPublicPort
  )
  return {
    advertisedHost,
    advertisedHostInferred:
      !environment.KILN_RELAY_HOST?.trim() && !coolifyPublicOrigin,
    brickCatalogUrl:
      environment.KILN_BRICKS_CATALOG_URL?.trim() ||
      "https://raw.githubusercontent.com/kiln-site/bricks/main/catalog.yml",
    bootstrapToken: bootstrapToken(environment),
    browserOrigin:
      proxyMode === "traefik"
        ? `https://${formatUrlHost(advertisedHost)}`
        : proxyMode === "coolify"
          ? (coolifyPublicOrigin ?? `https://${formatUrlHost(advertisedHost)}`)
        : directBrowserOrigin,
    coolifyPublicOrigin,
    composeFile: `${dataDirectory}/instances/compose.yaml`,
    connectDomain: "test",
    connectPort: 25_565,
    directBrowserOrigin,
    directPublicPort,
    dockerSocket: "/var/run/docker.sock",
    dataDirectory,
    host: environment.KILN_RELAY_BIND_HOST?.trim() || "0.0.0.0",
    managedLabel: "kiln.relay.managed=true",
    nodeId: "kiln-relay",
    nodeName: environment.KILN_RELAY_NAME?.trim() || hostname() || "Kiln Relay",
    port,
    publicPort,
    projectDirectory: `${dataDirectory}/instances`,
    projectName: "mc-servers",
    proxyMode,
    rootDirectory: `${dataDirectory}/instances`,
    serverIdLabel: "kiln.server.id",
    sftpDevAuthentication: sftpDevAuthentication(environment),
    sftpPort: parsePort(environment, "KILN_RELAY_SFTP_PORT", 2022),
    tlsCertificatePath: environment.KILN_RELAY_TLS_CERT_FILE?.trim() || null,
    tlsKeyPath: environment.KILN_RELAY_TLS_KEY_FILE?.trim() || null,
    tlsMode,
    traefikAcmeEmail: environment.KILN_RELAY_ACME_EMAIL?.trim() || null,
    traefikImage: traefikImage(environment),
  }
}

function relayProxyMode(environment: NodeJS.ProcessEnv): RelayProxyMode {
  const value = environment.KILN_RELAY_PROXY?.trim() || "none"
  if (
    value === "none" ||
    value === "hearth" ||
    value === "traefik" ||
    value === "coolify"
  ) {
    return value
  }
  throw new Error(
    "KILN_RELAY_PROXY must be none, hearth, traefik, or coolify"
  )
}

function relayCoolifyPublicOrigin(
  environment: NodeJS.ProcessEnv,
  relayPort: number
): string | null {
  const configuredUrl = environment.KILN_RELAY_PUBLIC_URL?.trim()
  if (configuredUrl) return parseCoolifyPublicOrigin(configuredUrl)

  const configuredHost = environment.KILN_RELAY_HOST?.trim()
  if (configuredHost) {
    return parseCoolifyPublicOrigin(
      `https://${formatUrlHost(configuredHost)}`
    )
  }

  const generatedServiceUrls = Object.entries(environment)
    .filter(([name]) =>
      new RegExp(`^SERVICE_(?:URL|FQDN)_.+_${relayPort}$`, "u").test(name)
    )
    .map(([, value]) => value)
  const raw = [
    environment[`SERVICE_URL_KILN_RELAY_${relayPort}`],
    environment[`SERVICE_FQDN_KILN_RELAY_${relayPort}`],
    ...generatedServiceUrls,
    environment.COOLIFY_URL,
    environment.COOLIFY_FQDN,
  ]
    .flatMap((value) => value?.split(",") ?? [])
    .map((value) => value.trim())
    .find(Boolean)
  if (!raw) return null
  const url = new URL(parseCoolifyPublicOrigin(raw))
  // In a Coolify domain, the suffix selects the private container port; the
  // public proxy still serves HTTPS on 443.
  if (url.port === String(relayPort)) url.port = ""
  return url.origin
}

function parseCoolifyPublicOrigin(raw: string): string {
  const withScheme = raw.includes("://") ? raw : `https://${raw}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch (cause) {
    throw new Error("The Coolify Relay public URL is invalid", { cause })
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "The Coolify Relay public URL must be an HTTPS origin without credentials, a path, query, or fragment"
    )
  }
  return url.origin
}

function effectiveUrlPort(url: URL): number {
  if (url.port) return Number(url.port)
  return url.protocol === "https:" ? 443 : 80
}

function traefikImage(environment: NodeJS.ProcessEnv): string {
  const value = environment.KILN_RELAY_TRAEFIK_IMAGE?.trim() || "traefik:v3.6.6"
  if (!/^traefik(?:@sha256:[a-f0-9]{64}|:[A-Za-z0-9._-]+)$/u.test(value)) {
    throw new Error(
      "KILN_RELAY_TRAEFIK_IMAGE must use an official pinned Traefik tag or digest"
    )
  }
  return value
}

export async function discoverRelayAdvertisedHost(
  config: RelayConfig,
  environment: NodeJS.ProcessEnv = process.env,
  discover: () => Promise<string> = discoverPublicIp
): Promise<"configured" | "hostname" | "public_ip"> {
  if (!config.advertisedHostInferred) return "configured"
  if (!booleanEnvironment(environment.KILN_RELAY_DISCOVER_PUBLIC_IP, true)) {
    return "hostname"
  }
  try {
    const address = await withTimeout(discover(), 2_000)
    if (!address) return "hostname"
    config.advertisedHost = address
    config.directBrowserOrigin = relayBrowserOrigin(
      config.tlsMode,
      address,
      config.directPublicPort
    )
    config.browserOrigin =
      config.proxyMode === "traefik"
        ? `https://${formatUrlHost(address)}`
        : config.proxyMode === "coolify"
          ? (config.coolifyPublicOrigin ?? `https://${formatUrlHost(address)}`)
        : config.directBrowserOrigin
    return "public_ip"
  } catch {
    return "hostname"
  }
}

function relayBrowserOrigin(
  tlsMode: RelayTlsMode,
  advertisedHost: string,
  publicPort: number
): string {
  const scheme = tlsMode === "development" ? "http" : "https"
  const defaultPort = scheme === "https" ? 443 : 80
  return `${scheme}://${formatUrlHost(advertisedHost)}${publicPort === defaultPort ? "" : `:${publicPort}`}`
}

function withTimeout<T>(promise: Promise<T>, delay: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Public IP discovery timed out")),
      delay
    )
    void promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (cause: unknown) => {
        clearTimeout(timer)
        reject(cause)
      }
    )
  })
}

async function discoverPublicIp(): Promise<string> {
  const resolver = new Resolver()
  resolver.setServers(["208.67.222.222", "208.67.220.220"])
  const addresses = await resolver.resolve4("myip.opendns.com")
  const address = addresses[0]
  if (!address) throw new Error("Public DNS returned no address")
  return address
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
  const normalized = value?.trim()
  if (!normalized) return fallback
  if (normalized === "true") return true
  if (normalized === "false") return false
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
