import { createServer as createHttpServer } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import * as Sentry from "@sentry/node"
import { Effect } from "effect"

import {
  relayConsoleCommandSchema,
  relayConsoleCompletionInputSchema,
  relayCreateInstanceSchema,
  relayInstanceActionSchema,
  relayInstanceWebRoutesSchema,
  relayNetworkingSchema,
  relayProxySettingsSchema,
  relaySaveFileInputSchema,
  relayBootstrapDiscoveryTranscript,
} from "@workspace/contracts"
import type { RelayControlRequest } from "@workspace/contracts"

import { BrickCatalog } from "./bricks.js"
import { attachBrowserSocket } from "./browser-socket.js"
import { discoverRelayAdvertisedHost, loadConfig } from "./config.js"
import { attachControlSocket } from "./control-socket.js"
import { DockerDriver } from "./docker.js"
import { FilesystemDriver } from "./files.js"
import { LifecycleDriver } from "./lifecycle.js"
import { nodeSnapshot } from "./node.js"
import { RelayPairingError } from "./effect/errors.js"
import {
  loadOrCreateRelayIdentity,
  renameRelayIdentity,
} from "./effect/identity.js"
import {
  decodePairingRequest,
  createPairingInvitation,
  initializePairing,
  pairHearth,
  renderPairingInvitation,
} from "./effect/pairing.js"
import {
  disposeRelayRuntime,
  initializeRelayRuntime,
  runRelayEffect,
} from "./effect/runtime.js"
import { RelayStateStore } from "./effect/state.js"
import type { RelayClientGrant, RelayClientRole } from "./effect/state.js"
import { loadRelayTls } from "./effect/tls.js"
import { normalizedRoute } from "./route-label.js"
import { closeRelayServer } from "./shutdown.js"
import { attachSftpServer } from "./sftp-server.js"
import { actionsForRole, relayActions } from "./permissions.js"
import type { RelayAction } from "./permissions.js"
import { normalizeSourceCidrs } from "./source-policy.js"
import { RelaySnapshotHub } from "./snapshot-hub.js"
import type { IncomingMessage, ServerResponse } from "node:http"

const config = loadConfig()
const advertisedHostSource = await discoverRelayAdvertisedHost(config)
if (advertisedHostSource !== "configured") {
  console.warn(
    advertisedHostSource === "public_ip"
      ? `KILN_RELAY_HOST was not set; inferred ${config.advertisedHost} from public DNS.`
      : `KILN_RELAY_HOST was not set; using hostname ${config.advertisedHost}.`
  )
  console.warn(
    "The inferred Relay endpoint is unverified and may be unusable behind NAT, inside Docker, or when an origin address should remain hidden. Set KILN_RELAY_HOST explicitly after checking reachability."
  )
}
await mkdir(config.rootDirectory, { recursive: true })
await mkdir(`${config.dataDirectory}/network`, { recursive: true, mode: 0o700 })
initializeRelayRuntime(config)
const startupCore = await runRelayEffect(
  "relay.startup",
  Effect.gen(function* () {
    const state = yield* RelayStateStore
    const identity = yield* loadOrCreateRelayIdentity(config)
    return { identity, state }
  })
)
const cliArguments = process.argv.slice(2)
let relayIdentity = startupCore.identity
config.nodeName = relayIdentity.name
const bricks = new BrickCatalog(config.brickCatalogUrl)
const docker = new DockerDriver(config)
const filesystem = new FilesystemDriver(config)
const lifecycle = new LifecycleDriver(config, docker, bricks)
const startupProxySettings = await lifecycle.proxySettings()
lifecycle.hydrateProxySettings(startupProxySettings)
let activeTls = await runRelayEffect("relay.startup.tls", loadRelayTls(config))
const startup = { ...startupCore, tls: activeTls }
if (cliArguments[0] === "pair" || cliArguments[0] === "hearth") {
  await runRelayCli(cliArguments)
  await disposeRelayRuntime()
  process.exit(0)
}
const initialPairing = await runRelayEffect(
  "relay.startup.pairing",
  initializePairing({
    config,
    identity: relayIdentity,
    state: startup.state,
    tls: startup.tls,
  })
)
if (initialPairing.kind === "automatic") {
  console.log(
    "Automatic Relay pairing is pending; the bootstrap token has been redacted."
  )
} else if (initialPairing.invitation) {
  console.log(renderPairingInvitation(initialPairing.invitation))
}
await lifecycle.initializeProxy(
  await runRelayEffect(
    "relay.startup.webRoutes",
    startup.state.listWebRoutes()
  ),
  startupProxySettings
)
const instanceMutations = new Map<string, Promise<unknown>>()
let webRouteMutation: Promise<unknown> = Promise.resolve()
const snapshotHub = new RelaySnapshotHub(relaySnapshot)

async function runRelayCli(arguments_: ReadonlyArray<string>): Promise<void> {
  const [resource, command = resource === "pair" ? "create" : "list"] =
    arguments_
  if (resource === "pair" && command === "create") {
    const role = arguments_.includes("--read-only")
      ? "read_only"
      : "full_access"
    const invitation = await runRelayEffect(
      "relay.cli.pair.create",
      Effect.gen(function* () {
        const created = yield* createPairingInvitation({
          config,
          identity: relayIdentity,
          role,
          state: startup.state,
          tls: startup.tls,
        })
        const initialized = yield* startup.state.getMetadata(
          "networking_initial_invitation"
        )
        if (!initialized) {
          yield* startup.state.setMetadata(
            "networking_initial_invitation",
            JSON.stringify({
              createdAt: Date.now(),
              invitationId: created.envelope.invitationId,
              kind: "cli",
            })
          )
        }
        return created
      })
    )
    console.log(renderPairingInvitation(invitation))
    console.log(
      `Created ${role} invitation ${invitation.envelope.invitationId}; its token was displayed only in this terminal.`
    )
    return
  }
  if (resource === "pair" && command === "list") {
    const invitations = await runRelayEffect(
      "relay.cli.pair.list",
      startup.state.listInvitations(Date.now())
    )
    console.log(
      JSON.stringify(
        invitations.map(
          ({ tokenHash: _tokenHash, ...invitation }) => invitation
        ),
        null,
        2
      )
    )
    return
  }
  if (resource === "pair" && command === "revoke") {
    const invitationId = requiredCliArgument(arguments_[2], "invitation ID")
    const revoked = await runRelayEffect(
      "relay.cli.pair.revoke",
      startup.state.revokeInvitation(invitationId, Date.now())
    )
    console.log(revoked ? `Revoked ${invitationId}` : "Invitation not found")
    return
  }
  if (resource === "hearth" && command === "list") {
    const clients = await runRelayEffect(
      "relay.cli.hearth.list",
      startup.state.listClients()
    )
    console.log(
      JSON.stringify(
        clients.map(({ publicKey: _publicKey, ...client }) => client),
        null,
        2
      )
    )
    return
  }
  if (resource === "hearth" && command === "revoke") {
    const clientId = requiredCliArgument(arguments_[2], "client ID")
    const revoked = await runRelayEffect(
      "relay.cli.hearth.revoke",
      startup.state.revokeClient(clientId, Date.now())
    )
    console.log(revoked ? `Revoked ${clientId}` : "Hearth client not found")
    return
  }
  throw new Error(
    "Usage: kiln-relay pair create|list|revoke or kiln-relay hearth list|revoke"
  )
}

function requiredCliArgument(
  value: string | undefined,
  description: string
): string {
  if (!value?.trim()) throw new Error(`Missing ${description}`)
  return value.trim()
}

const requestHandler = async (
  request: IncomingMessage,
  response: ServerResponse
) => {
  try {
    if (healthCheck(request, response)) return
    if (trustProbe(request, response)) return
    if (bootstrapDiscovery(request, response)) return
    if (await pairingRequest(request, response)) return
    if (await browserSocket.handleRequest(request, response)) return
    json(response, 426, {
      error: "Relay control operations require a WebSocket transport",
      code: "websocket_required",
    })
  } catch (error) {
    const cause = error
    if (cause instanceof RelayPairingError) {
      json(response, 401, { error: cause.message, code: cause.code })
      return
    }
    Sentry.captureException(cause, {
      tags: { "kiln.operation": normalizedRequestOperation(request.url) },
    })
    const message = cause instanceof Error ? cause.message : "Unknown error"
    console.error(cause)
    json(response, 500, { error: message, code: "internal_error" })
  }
}

const server = activeTls
  ? createHttpsServer(
      { cert: activeTls.certificatePem, key: activeTls.keyPem },
      requestHandler
    )
  : createHttpServer(requestHandler)

const controlSocket = attachControlSocket({
  execute: executeControlRequest,
  identity: relayIdentity,
  initialSnapshot: () => snapshotHub.read(),
  runEffect: (effect) => runRelayEffect("relay.control.state", effect),
  server,
  state: startup.state,
  subscribeSnapshots: (listener) =>
    snapshotHub.subscribe(({ snapshot }) => listener(snapshot), false),
})
const browserSocket = attachBrowserSocket({
  docker,
  filesystem,
  identity: relayIdentity,
  runEffect: (effect) => runRelayEffect("relay.browser.state", effect),
  server,
  state: startup.state,
  subscribeSnapshots: (listener) => snapshotHub.subscribe(listener),
})
const sftpServer = await attachSftpServer({
  clientActions: async (clientId) =>
    (
      await runRelayEffect(
        "relay.sftp.clientGrant",
        startup.state.findClientById(clientId)
      )
    )?.actions ?? [],
  config,
  control: controlSocket,
  docker,
})

await lifecycle.assertPrivateProxyListener()
server.listen(config.port, config.host, () => {
  console.log(
    `Relay ${relayIdentity.fingerprint} (${relayIdentity.name}) listening on ${activeTls ? "https" : "http"}://${config.host}:${config.port}`
  )
  console.log(
    `Discovering ${config.managedLabel} containers in ${config.rootDirectory}`
  )
})
const tlsRefresh = scheduleTlsRefresh()

let shutdownStarted = false
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (shutdownStarted) return
    shutdownStarted = true
    void shutdownRelay(signal)
  })
}

async function pairingRequest(
  request: IncomingMessage,
  response: ServerResponse
): Promise<boolean> {
  const method = request.method ?? "GET"
  const url = new URL(request.url ?? "/", "http://relay")
  if (method !== "POST" || url.pathname !== "/v1/pair") return false
  const result = await runRelayEffect(
    "relay.pairing.enroll",
    Effect.gen(function* () {
      const input = yield* Effect.tryPromise(() => readJson(request))
      const pairing = yield* decodePairingRequest(input)
      return yield* pairHearth({
        bootstrapToken: config.bootstrapToken,
        identity: relayIdentity,
        request: pairing,
        state: startup.state,
      })
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof RelayPairingError
          ? cause
          : RelayPairingError.make({ code: "invalid_pairing_request", cause })
      )
    )
  )
  json(response, 201, result)
  return true
}

function trustProbe(
  request: IncomingMessage,
  response: ServerResponse
): boolean {
  const method = request.method ?? "GET"
  const url = new URL(request.url ?? "/", "http://relay")
  if (
    url.pathname === "/v1/trust/ca.pem" &&
    (method === "GET" || method === "HEAD")
  ) {
    if (!activeTls?.caCertificatePem) {
      json(response, 404, { error: "Relay does not use a managed local CA" })
      return true
    }
    response
      .writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
        "Content-Disposition": "attachment; filename=kiln-relay-ca.pem",
        "Content-Length": String(Buffer.byteLength(activeTls.caCertificatePem)),
        "Content-Type": "application/x-pem-file",
        "X-Content-Type-Options": "nosniff",
      })
      .end(method === "HEAD" ? undefined : activeTls.caCertificatePem)
    return true
  }
  if (url.pathname !== "/v1/trust" || (method !== "GET" && method !== "HEAD")) {
    return false
  }
  response
    .writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    })
    .end(
      method === "HEAD"
        ? undefined
        : JSON.stringify({
            relayFingerprint: relayIdentity.fingerprint,
            relayName: relayIdentity.name,
            proxyMode: config.proxyMode,
            tlsFingerprint: activeTls?.fingerprint ?? null,
            version: 1,
          })
    )
  return true
}

function bootstrapDiscovery(
  request: IncomingMessage,
  response: ServerResponse
): boolean {
  const method = request.method ?? "GET"
  const url = new URL(request.url ?? "/", "http://relay")
  if (url.pathname !== "/v1/bootstrap" || method !== "GET") return false
  const invitation = initialPairing.invitation
  const clientNonce = url.searchParams.get("nonce")
  if (
    initialPairing.kind !== "automatic" ||
    !invitation ||
    !config.bootstrapToken ||
    !clientNonce ||
    Buffer.from(clientNonce, "base64url").length < 16
  ) {
    json(response, 404, { error: "Automatic pairing is not available" })
    return true
  }
  const serverNonce = randomBytes(32).toString("base64url")
  const transcript = {
    clientNonce,
    controlEndpoint: invitation.envelope.controlEndpoint,
    expiresAt: invitation.envelope.expiresAt,
    invitationId: invitation.envelope.invitationId,
    relayFingerprint: invitation.envelope.relayFingerprint,
    relayPublicKeyPem: invitation.envelope.relayPublicKeyPem,
    serverNonce,
    tlsFingerprint:
      activeTls?.fingerprint ??
      (config.proxyMode === "coolify" || config.proxyMode === "traefik"
        ? "edge-terminated"
        : "development"),
  }
  const { token: _token, ...envelope } = invitation.envelope
  json(response, 200, {
    envelope,
    proof: createHmac("sha256", config.bootstrapToken)
      .update(relayBootstrapDiscoveryTranscript(transcript))
      .digest("base64url"),
    serverNonce,
    tlsFingerprint: transcript.tlsFingerprint,
  })
  return true
}

function scheduleTlsRefresh(): { close: () => void } {
  if (!activeTls || !("setSecureContext" in server)) {
    return { close: () => undefined }
  }
  let closed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = (delay: number) => {
    if (closed) return
    timer = setTimeout(() => void refresh(), delay)
    timer.unref()
  }
  const refresh = async () => {
    try {
      const material = await runRelayEffect(
        "relay.tls.refresh",
        loadRelayTls(config)
      )
      if (!material) throw new Error("TLS mode changed while Relay was running")
      if (material.fingerprint !== activeTls?.fingerprint) {
        server.setSecureContext({
          cert: material.certificatePem,
          key: material.keyPem,
        })
        console.log(`Relay TLS certificate reloaded (${material.fingerprint})`)
      }
      activeTls = material
      schedule(material.mode === "external" ? 60_000 : 6 * 60 * 60_000)
    } catch (cause) {
      Sentry.captureException(cause, {
        tags: { "kiln.operation": "relay.tls.refresh" },
      })
      console.error(
        "Relay TLS refresh failed; retaining the last valid certificate",
        cause
      )
      schedule(60_000)
    }
  }
  schedule(activeTls.mode === "external" ? 60_000 : 6 * 60 * 60_000)
  return {
    close: () => {
      closed = true
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}

async function shutdownRelay(signal: NodeJS.Signals): Promise<void> {
  console.log(`Received ${signal}; shutting down relay`)
  tlsRefresh.close()
  lifecycle.close()
  snapshotHub.close()
  await Promise.all([
    controlSocket.close(),
    browserSocket.close(),
    sftpServer.close(),
  ])
  const result = await closeRelayServer(server, new Set())
  if (result === "forced") {
    console.warn("Relay shutdown deadline reached; closed active connections")
  }
  const cleanup = await Promise.allSettled([
    disposeRelayRuntime(),
    Sentry.close(2_000),
  ])
  for (const outcome of cleanup) {
    if (outcome.status === "rejected") {
      console.error("Relay shutdown cleanup failed", outcome.reason)
    }
  }
  process.exit(0)
}

async function relaySnapshot() {
  const [node, instances] = await Promise.all([
    nodeSnapshot(config, docker),
    docker.inspectInstances(),
  ])
  return {
    node,
    instances,
    relay: {
      id: relayIdentity.fingerprint,
      name: relayIdentity.name,
      sftp: {
        developmentAuthentication: config.sftpDevAuthentication,
        host: config.advertisedHost,
        hostKeyFingerprint: sftpServer.hostKeyFingerprint,
        port: sftpServer.port,
      },
      tls: activeTls
        ? {
            expiresAt: activeTls.expiresAt,
            fingerprint: activeTls.fingerprint,
            mode: activeTls.mode,
          }
        : null,
    },
  }
}

async function executeControlRequest(
  request: RelayControlRequest,
  client: RelayClientGrant,
  signal: AbortSignal
): Promise<unknown> {
  if (signal.aborted) throw new Error("Relay request was cancelled")
  const payload = payloadRecord(request.payload)
  switch (request.operation) {
    case "relay.snapshot":
      return snapshotHub.read()
    case "relay.networking.read":
      return (await lifecycle.networking()) ?? null
    case "relay.networking.write":
      return lifecycle.configureNetworking(
        relayNetworkingSchema.parse(request.payload)
      )
    case "relay.proxy.read": {
      const settings = await lifecycle.proxySettings()
      return {
        diagnostics: await lifecycle.proxyDiagnostics(settings),
        settings,
      }
    }
    case "relay.proxy.write": {
      const settings = relayProxySettingsSchema.parse(request.payload)
      const routes = await runRelayEffect(
        "relay.proxy.routes",
        startup.state.listWebRoutes()
      )
      return lifecycle.configureProxy(settings, routes)
    }
    case "relay.audit.list":
      return runRelayEffect(
        "relay.control.audit.list",
        startup.state.listAudits(
          typeof payload.limit === "number" ? payload.limit : 50
        )
      )
    case "relay.pairing.create": {
      const role = relayClientRole(payload.role)
      const customActions = relayActionSelection(payload.actions)
      const invitation = await runRelayEffect(
        "relay.control.pairing.create",
        createPairingInvitation({
          config,
          actions: customActions,
          identity: relayIdentity,
          role,
          state: startup.state,
          tls: activeTls,
        })
      )
      console.log(
        `Created pairing invitation ${invitation.envelope.invitationId}; its secret was returned only to the requesting Hearth.`
      )
      await appendRelayAudit("invitation.created", client.id, request.id, {
        invitationId: invitation.envelope.invitationId,
        role,
      })
      return invitation
    }
    case "relay.pairing.list": {
      const invitations = await runRelayEffect(
        "relay.control.pairing.list",
        startup.state.listInvitations(Date.now())
      )
      return invitations.map(
        ({ tokenHash: _tokenHash, ...invitation }) => invitation
      )
    }
    case "relay.pairing.revoke": {
      const invitationId = requiredString(payload, "invitationId")
      const revoked = await runRelayEffect(
        "relay.control.pairing.revoke",
        startup.state.revokeInvitation(invitationId, Date.now())
      )
      if (revoked) {
        await appendRelayAudit("invitation.revoked", client.id, request.id, {
          invitationId,
        })
      }
      return { invitationId, revoked }
    }
    case "relay.clients.list": {
      const clients = await runRelayEffect(
        "relay.control.clients.list",
        startup.state.listClients()
      )
      return clients.map(
        ({ publicKey: _publicKey, ...relayClient }) => relayClient
      )
    }
    case "relay.clients.update": {
      const clientId = requiredString(payload, "clientId")
      const role = relayClientRole(payload.role)
      const name = requiredString(payload, "name").trim()
      if (name.length > 120) throw new Error("Hearth name is too long")
      const sourceCidrs = normalizeSourceCidrs(payload.sourceCidrs ?? [])
      const actions = actionsForRole(
        role,
        relayActionSelection(payload.actions)
      )
      const updated = await runRelayEffect(
        "relay.control.clients.update",
        startup.state.updateClient({
          actions,
          clientId,
          name,
          role,
          sourceCidrs,
        })
      )
      if (updated) {
        await appendRelayAudit("client.policy_changed", client.id, request.id, {
          clientId,
          role,
          sourceCidrs,
        })
        browserSocket.revokeClient(clientId)
        scheduleClientReconnect(clientId)
      }
      return { actions, clientId, role, updated }
    }
    case "relay.clients.revoke": {
      const clientId = requiredString(payload, "clientId")
      const revoked = await runRelayEffect(
        "relay.control.clients.revoke",
        startup.state.revokeClient(clientId, Date.now())
      )
      if (revoked) {
        await appendRelayAudit("client.revoked", client.id, request.id, {
          clientId,
        })
        browserSocket.revokeClient(clientId)
        scheduleClientRevocation(clientId)
      }
      return { clientId, revoked }
    }
    case "brick.catalog":
      return bricks.catalog()
    case "brick.recipe":
      return {
        ...(await bricks.recipe(requiredString(payload, "source"))),
        source: requiredString(payload, "source"),
      }
    case "instance.create":
      return lifecycle.createInstance(
        relayCreateInstanceSchema.parse(request.payload)
      )
    case "instance.delete": {
      const instanceId = requiredString(payload, "instanceId")
      await serializeInstanceMutation(instanceId, () =>
        lifecycle.deleteInstance(instanceId, payload.deleteData === true)
      )
      await serializeWebRouteMutation(async () => {
        await runRelayEffect(
          "relay.network.routes.deleteInstance",
          startup.state.replaceInstanceRoutes(instanceId, [])
        )
        await lifecycle.configureWebRoutes(
          await runRelayEffect(
            "relay.network.routes.afterDelete",
            startup.state.listWebRoutes()
          )
        )
      })
      return { deleted: true, instanceId }
    }
    case "instance.action": {
      const instance = await requiredInstance(payload)
      const input = relayInstanceActionSchema.parse(payload)
      const runAction = () =>
        serializeInstanceMutation(instance.id, async () => {
          const routes = await runRelayEffect(
            "relay.network.routes.forAction",
            startup.state.listInstanceRoutes(instance.id)
          )
          return lifecycle.runInstanceAction(instance, input.action, routes)
        })
      return input.action === "start" || input.action === "restart"
        ? serializeWebRouteMutation(runAction)
        : runAction()
    }
    case "instance.files.list":
      return filesystem.tree(await requiredInstance(payload))
    case "instance.files.read":
      return filesystem.read(
        await requiredInstance(payload),
        requiredString(payload, "path")
      )
    case "instance.files.write": {
      const instance = await requiredInstance(payload)
      const input = relaySaveFileInputSchema.parse(payload)
      return serializeInstanceMutation(instance.id, () =>
        filesystem.write(instance, requiredString(payload, "path"), input)
      )
    }
    case "instance.console.history":
      return docker.console(
        await requiredInstance(payload),
        typeof payload.limit === "number" ? payload.limit : 2_000
      )
    case "instance.console.write": {
      const instance = await requiredInstance(payload)
      const input = relayConsoleCommandSchema.parse(payload)
      await docker.sendCommand(instance, input.command)
      return { accepted: true, command: input.command }
    }
    case "instance.console.complete": {
      const instance = await requiredInstance(payload)
      const input = relayConsoleCompletionInputSchema.parse(payload)
      return docker.completeCommand(instance, input.input, input.cursor)
    }
    case "instance.logs.latest":
      return filesystem.latestLog(await requiredInstance(payload))
    case "instance.network.routes.read": {
      const instance = await requiredInstance(payload)
      const routes = await runRelayEffect(
        "relay.network.routes.read",
        startup.state.listInstanceRoutes(instance.id)
      )
      return lifecycle.webRouteState(instance.id, routes)
    }
    case "instance.network.routes.write": {
      return serializeWebRouteMutation(async () => {
        const instance = await requiredInstance(payload)
        const routes = relayInstanceWebRoutesSchema.parse(payload.routes)
        const configuredRoutes = await runRelayEffect(
          "relay.network.routes.collisionCheck",
          startup.state.listWebRoutes()
        )
        const collision = routes.find((route) =>
          configuredRoutes.some(
            (configured) =>
              configured.instanceId !== instance.id &&
              configured.hostname === route.hostname &&
              configured.path === route.path
          )
        )
        if (collision) {
          throw new Error(
            `Another Ember already uses https://${collision.hostname}${collision.path ?? ""}. Hostname and path routes must be unique on a Relay.`
          )
        }
        const previous = await runRelayEffect(
          "relay.network.routes.previous",
          startup.state.listInstanceRoutes(instance.id)
        )
        await runRelayEffect(
          "relay.network.routes.replace",
          startup.state.replaceInstanceRoutes(instance.id, routes)
        )
        try {
          const allRoutes = await runRelayEffect(
            "relay.network.routes.all",
            startup.state.listWebRoutes()
          )
          await lifecycle.configureWebRoutes(allRoutes)
        } catch (cause) {
          await runRelayEffect(
            "relay.network.routes.rollback",
            startup.state.replaceInstanceRoutes(instance.id, previous)
          )
          await lifecycle.configureWebRoutes(
            await runRelayEffect(
              "relay.network.routes.rollbackAll",
              startup.state.listWebRoutes()
            )
          )
          throw cause
        }
        return lifecycle.webRouteState(instance.id, routes)
      })
    }
    case "relay.rename": {
      relayIdentity = await runRelayEffect(
        "relay.control.rename",
        renameRelayIdentity(
          config,
          relayIdentity,
          requiredString(payload, "name")
        )
      )
      config.nodeName = relayIdentity.name
      await appendRelayAudit("relay.renamed", client.id, request.id, {
        name: relayIdentity.name,
      })
      return { id: relayIdentity.fingerprint, name: relayIdentity.name }
    }
    case "sftp.authorization.resolve":
      throw new Error(`${request.operation} is not available yet`)
  }
}

function relayClientRole(value: unknown): RelayClientRole {
  if (value === "full_access" || value === "read_only" || value === "custom") {
    return value
  }
  throw new Error("Relay client role is invalid")
}

function relayActionSelection(value: unknown): ReadonlyArray<RelayAction> {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > relayActions.length) {
    throw new Error("Relay client actions are invalid")
  }
  const selected = new Set(value)
  if ([...selected].some((action) => typeof action !== "string")) {
    throw new Error("Relay client actions are invalid")
  }
  return relayActions.filter((action) => selected.has(action))
}

async function appendRelayAudit(
  event: string,
  clientId: string | null,
  requestId: string | null,
  details: Readonly<Record<string, unknown>>
): Promise<void> {
  await runRelayEffect(
    `relay.audit.${event}`,
    startup.state.appendAudit({
      clientId,
      details,
      event,
      id: randomUUID(),
      occurredAt: Date.now(),
      requestId,
    })
  )
}

function scheduleClientReconnect(clientId: string): void {
  const timer = setTimeout(() => controlSocket.refreshClient(clientId), 25)
  timer.unref()
}

function scheduleClientRevocation(clientId: string): void {
  const timer = setTimeout(() => controlSocket.revokeClient(clientId), 25)
  timer.unref()
}

function payloadRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Relay request payload must be an object")
  }
  return Object.fromEntries(Object.entries(value))
}

function requiredString(
  value: Readonly<Record<string, unknown>>,
  key: string
): string {
  const field = value[key]
  if (typeof field !== "string" || !field) {
    throw new Error(`${key} is required`)
  }
  return field
}

async function requiredInstance(payload: Readonly<Record<string, unknown>>) {
  const instanceId = requiredString(payload, "instanceId")
  const instance = await docker.findInstance(instanceId)
  if (!instance) throw new Error("Instance not found")
  return instance
}

async function serializeInstanceMutation<T>(
  instanceId: string,
  mutate: () => Promise<T>
): Promise<T> {
  const previous = instanceMutations.get(instanceId) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(mutate)
  instanceMutations.set(instanceId, current)
  try {
    return await current
  } finally {
    if (instanceMutations.get(instanceId) === current) {
      instanceMutations.delete(instanceId)
    }
  }
}

async function serializeWebRouteMutation<T>(
  mutate: () => Promise<T>
): Promise<T> {
  const current = webRouteMutation.catch(() => undefined).then(mutate)
  webRouteMutation = current
  return current
}

function normalizedRequestOperation(url: string | undefined): string {
  return normalizedRoute(new URL(url ?? "/", "http://relay").pathname)
}

function healthCheck(
  request: IncomingMessage,
  response: ServerResponse
): boolean {
  const method = request.method ?? "GET"
  if (method !== "GET" && method !== "HEAD") return false
  const url = new URL(request.url ?? "/", "http://relay")
  if (url.pathname !== "/health") return false
  response.writeHead(204, { "Cache-Control": "no-store" }).end()
  return true
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Array<Buffer> = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > 2 * 1024 * 1024) throw new Error("Request body is too large")
    chunks.push(buffer)
  }
  const body = Buffer.concat(chunks).toString("utf8")
  return body ? (JSON.parse(body) as unknown) : {}
}

function json(response: ServerResponse, status: number, value: unknown): void {
  if (response.destroyed || response.writableEnded) return
  if (response.headersSent) {
    response.destroy()
    return
  }
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  })
  response.end(JSON.stringify(value))
}
