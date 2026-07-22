import { createServer as createHttpServer } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { createHmac, randomBytes } from "node:crypto"
import { mkdir } from "node:fs/promises"
import * as Sentry from "@sentry/node"
import { Effect } from "effect"

import {
  relayConsoleCommandSchema,
  relayConsoleCompletionInputSchema,
  relayCreateInstanceSchema,
  relayInstanceActionSchema,
  relayNetworkingSchema,
  relaySaveFileInputSchema,
  relayBootstrapDiscoveryTranscript,
} from "@workspace/contracts"
import type { RelayControlRequest } from "@workspace/contracts"

import { BrickCatalog } from "./bricks.js"
import { attachBrowserSocket } from "./browser-socket.js"
import { loadConfig } from "./config.js"
import { attachControlSocket } from "./control-socket.js"
import { DockerDriver } from "./docker.js"
import { FilesystemDriver, RelayFilesystemError } from "./files.js"
import { LifecycleDriver } from "./lifecycle.js"
import { nodeSnapshot } from "./node.js"
import {
  BrickRecipeError,
  RelayOperationError,
  RelayPairingError,
} from "./effect/errors.js"
import { loadOrCreateRelayIdentity } from "./effect/identity.js"
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
import { loadRelayTls } from "./effect/tls.js"
import { normalizedRoute } from "./route-label.js"
import { closeRelayServer } from "./shutdown.js"
import { attachSftpServer } from "./sftp-server.js"
import type { IncomingMessage, ServerResponse } from "node:http"

const config = loadConfig()
await mkdir(config.rootDirectory, { recursive: true })
await mkdir(`${config.dataDirectory}/network`, { recursive: true, mode: 0o700 })
initializeRelayRuntime(config)
const startup = await runRelayEffect(
  "relay.startup",
  Effect.gen(function* () {
    const state = yield* RelayStateStore
    const [identity, tls] = yield* Effect.all([
      loadOrCreateRelayIdentity(config),
      loadRelayTls(config),
    ])
    return { identity, state, tls }
  })
)
const cliArguments = process.argv.slice(2)
if (cliArguments[0] === "pair") {
  const role = cliArguments.includes("--read-only")
    ? "read_only"
    : "full_access"
  const invitation = await runRelayEffect(
    "relay.cli.pair",
    Effect.gen(function* () {
      const created = yield* createPairingInvitation({
        config,
        identity: startup.identity,
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
  console.log(await renderPairingInvitation(invitation))
  console.log(
    `Created ${role} invitation ${invitation.envelope.invitationId}; the URI was not written to Relay service logs.`
  )
  await disposeRelayRuntime()
  process.exit(0)
}
const initialPairing = await runRelayEffect(
  "relay.startup.pairing",
  initializePairing({
    config,
    identity: startup.identity,
    state: startup.state,
    tls: startup.tls,
  })
)
if (initialPairing.kind === "automatic") {
  console.log(
    "Automatic Relay pairing is pending; the bootstrap token has been redacted."
  )
} else if (initialPairing.invitation) {
  console.log(await renderPairingInvitation(initialPairing.invitation))
}
const bricks = new BrickCatalog(config.brickCatalogUrl)
const docker = new DockerDriver(config)
const filesystem = new FilesystemDriver(config)
const lifecycle = new LifecycleDriver(config, docker, bricks)
const activeConsoleStreams = new Map<string, number>()
const activeConsoleStreamControllers = new Set<AbortController>()
const MAX_CONSOLE_STREAMS_PER_INSTANCE = 6

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
    if (!authorize(response)) return
    const requestUrl = new URL(request.url ?? "/", "http://relay")
    await runRelayEffect(
      `relay.http.${normalizedRoute(requestUrl.pathname)}`,
      Effect.tryPromise({
        try: () => route(request, response),
        catch: (cause) =>
          RelayOperationError.make({
            operation: normalizedRoute(requestUrl.pathname),
            cause,
          }),
      })
    )
  } catch (error) {
    const cause = error instanceof RelayOperationError ? error.cause : error
    if (cause instanceof RelayFilesystemError) {
      json(response, 400, { error: cause.message, code: cause.code })
      return
    }
    if (cause instanceof BrickRecipeError) {
      json(response, 400, { error: cause.message, code: cause.code })
      return
    }
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

const server = startup.tls
  ? createHttpsServer(
      { cert: startup.tls.certificatePem, key: startup.tls.keyPem },
      requestHandler
    )
  : createHttpServer(requestHandler)

const controlSocket = attachControlSocket({
  execute: executeControlRequest,
  identity: startup.identity,
  initialSnapshot: () => relaySnapshot(),
  runEffect: (effect) => runRelayEffect("relay.control.state", effect),
  server,
  state: startup.state,
})
const browserSocket = attachBrowserSocket({
  docker,
  filesystem,
  identity: startup.identity,
  runEffect: (effect) => runRelayEffect("relay.browser.state", effect),
  server,
  state: startup.state,
})
const sftpServer = await attachSftpServer({
  config,
  control: controlSocket,
  docker,
})

server.listen(config.port, config.host, () => {
  console.log(
    `Relay ${startup.identity.fingerprint} (${startup.identity.name}) listening on ${startup.tls ? "https" : "http"}://${config.host}:${config.port}`
  )
  console.log(
    `Discovering ${config.managedLabel} containers in ${config.rootDirectory}`
  )
})

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
        identity: startup.identity,
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
    if (!startup.tls?.caCertificatePem) {
      json(response, 404, { error: "Relay does not use a managed local CA" })
      return true
    }
    response
      .writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
        "Content-Disposition": "attachment; filename=kiln-relay-ca.pem",
        "Content-Length": String(
          Buffer.byteLength(startup.tls.caCertificatePem)
        ),
        "Content-Type": "application/x-pem-file",
        "X-Content-Type-Options": "nosniff",
      })
      .end(method === "HEAD" ? undefined : startup.tls.caCertificatePem)
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
            relayFingerprint: startup.identity.fingerprint,
            relayName: startup.identity.name,
            tlsFingerprint: startup.tls?.fingerprint ?? null,
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
    tlsFingerprint: startup.tls?.fingerprint ?? "development",
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

async function shutdownRelay(signal: NodeJS.Signals): Promise<void> {
  console.log(`Received ${signal}; shutting down relay`)
  await Promise.all([
    controlSocket.close(),
    browserSocket.close(),
    sftpServer.close(),
  ])
  const result = await closeRelayServer(server, activeConsoleStreamControllers)
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
  return { node, instances }
}

async function executeControlRequest(
  request: RelayControlRequest,
  _client: unknown,
  signal: AbortSignal
): Promise<unknown> {
  if (signal.aborted) throw new Error("Relay request was cancelled")
  const payload = payloadRecord(request.payload)
  switch (request.operation) {
    case "relay.snapshot":
      return relaySnapshot()
    case "relay.networking.read":
      return (await lifecycle.networking()) ?? null
    case "relay.networking.write":
      return lifecycle.configureNetworking(
        relayNetworkingSchema.parse(request.payload)
      )
    case "relay.pairing.create": {
      const role = payload.role === "read_only" ? "read_only" : "full_access"
      const invitation = await runRelayEffect(
        "relay.control.pairing.create",
        createPairingInvitation({
          config,
          identity: startup.identity,
          role,
          state: startup.state,
          tls: startup.tls,
        })
      )
      console.log(
        `Created pairing invitation ${invitation.envelope.invitationId}; its secret was returned only to the requesting Hearth.`
      )
      return invitation
    }
    case "relay.clients.list":
      return runRelayEffect(
        "relay.control.clients.list",
        startup.state.listClients()
      )
    case "relay.clients.revoke": {
      const clientId = requiredString(payload, "clientId")
      const revoked = await runRelayEffect(
        "relay.control.clients.revoke",
        startup.state.revokeClient(clientId, Date.now())
      )
      if (revoked) controlSocket.revokeClient(clientId)
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
      await lifecycle.deleteInstance(instanceId, payload.deleteData === true)
      return { deleted: true, instanceId }
    }
    case "instance.action": {
      const instance = await requiredInstance(payload)
      const input = relayInstanceActionSchema.parse(payload)
      return docker.runAction(instance, input.action)
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
      return filesystem.write(instance, requiredString(payload, "path"), input)
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
    case "relay.rename":
    case "browser.capability.issue":
    case "sftp.authorization.resolve":
      throw new Error(`${request.operation} is not available yet`)
  }
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

function normalizedRequestOperation(url: string | undefined): string {
  return normalizedRoute(new URL(url ?? "/", "http://relay").pathname)
}

async function route(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`)
  const method = request.method ?? "GET"

  if (method === "GET" && url.pathname === "/v1/snapshot") {
    json(response, 200, await relaySnapshot())
    return
  }

  if (method === "GET" && url.pathname === "/v1/bricks") {
    json(response, 200, await bricks.catalog())
    return
  }

  if (method === "GET" && url.pathname === "/v1/bricks/recipe") {
    const source = url.searchParams.get("source")
    if (!source) {
      json(response, 400, {
        error: "Recipe source is required",
        code: "missing_recipe_source",
      })
      return
    }
    json(response, 200, { ...(await bricks.recipe(source)), source })
    return
  }

  if (url.pathname === "/v1/networking") {
    if (method === "GET") {
      json(response, 200, (await lifecycle.networking()) ?? null)
      return
    }
    if (method === "PUT") {
      const input = relayNetworkingSchema.parse(await readJson(request))
      json(response, 200, await lifecycle.configureNetworking(input))
      return
    }
  }

  if (method === "POST" && url.pathname === "/v1/instances") {
    const input = relayCreateInstanceSchema.parse(await readJson(request))
    json(response, 201, await lifecycle.createInstance(input))
    return
  }

  const instanceRoot = url.pathname.match(/^\/v1\/instances\/([^/]+)$/u)
  if (instanceRoot && method === "DELETE") {
    await lifecycle.deleteInstance(
      decodeURIComponent(instanceRoot[1]),
      url.searchParams.get("deleteData") === "true"
    )
    response.writeHead(204).end()
    return
  }

  const match = url.pathname.match(
    /^\/v1\/instances\/([^/]+)\/(tree|file|actions|console|console-completions|console-stream|latest-log)$/u
  )
  if (!match) {
    json(response, 404, { error: "Route not found", code: "not_found" })
    return
  }

  const id = decodeURIComponent(match[1])
  const instance = await docker.findInstance(id)
  if (!instance) {
    json(response, 404, { error: "Instance not found", code: "not_found" })
    return
  }

  const resource = match[2]
  if (method === "GET" && resource === "tree") {
    json(response, 200, await filesystem.tree(instance))
    return
  }

  if (resource === "file") {
    const path = url.searchParams.get("path") ?? ""
    if (method === "GET") {
      json(response, 200, await filesystem.read(instance, path))
      return
    }
    if (method === "PUT") {
      const input = relaySaveFileInputSchema.parse(await readJson(request))
      json(response, 200, await filesystem.write(instance, path, input))
      return
    }
  }

  if (method === "POST" && resource === "actions") {
    const input = relayInstanceActionSchema.parse(await readJson(request))
    json(response, 202, await docker.runAction(instance, input.action))
    return
  }

  if (resource === "console") {
    if (method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? 2_000)
      json(response, 200, await docker.console(instance, limit))
      return
    }
    if (method === "POST") {
      const input = relayConsoleCommandSchema.parse(await readJson(request))
      await docker.sendCommand(instance, input.command)
      json(response, 202, { accepted: true, command: input.command })
      return
    }
  }

  if (method === "POST" && resource === "console-completions") {
    const input = relayConsoleCompletionInputSchema.parse(
      await readJson(request)
    )
    json(
      response,
      200,
      await docker.completeCommand(instance, input.input, input.cursor)
    )
    return
  }

  if (method === "GET" && resource === "console-stream") {
    const activeStreams = activeConsoleStreams.get(instance.id) ?? 0
    if (activeStreams >= MAX_CONSOLE_STREAMS_PER_INSTANCE) {
      json(response, 429, {
        error: "Too many active console streams for this instance",
        code: "too_many_console_streams",
      })
      return
    }
    activeConsoleStreams.set(instance.id, activeStreams + 1)
    const controller = new AbortController()
    activeConsoleStreamControllers.add(controller)
    const close = () => controller.abort()
    response.once("close", close)
    response.once("error", close)
    response.writeHead(200, {
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no",
    })
    response.flushHeaders()
    let heartbeat: ReturnType<typeof setInterval> | null = null
    try {
      const ready = `${JSON.stringify({ type: "ready", instanceId: instance.id })}\n`
      if (!(await writeStreamChunk(response, ready, controller.signal))) return
      heartbeat = setInterval(() => {
        if (!response.destroyed && !response.writableEnded) response.write("\n")
      }, 15_000)
      for await (const line of docker.streamConsole(
        instance,
        controller.signal
      )) {
        const chunk = `${JSON.stringify({ type: "line", line })}\n`
        if (!(await writeStreamChunk(response, chunk, controller.signal))) break
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error(`Console stream for ${instance.id} failed`, error)
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat)
      response.off("close", close)
      response.off("error", close)
      activeConsoleStreamControllers.delete(controller)
      const remaining = (activeConsoleStreams.get(instance.id) ?? 1) - 1
      if (remaining > 0) activeConsoleStreams.set(instance.id, remaining)
      else activeConsoleStreams.delete(instance.id)
      if (!response.destroyed && !response.writableEnded) response.end()
    }
    return
  }

  if (method === "GET" && resource === "latest-log") {
    json(response, 200, await filesystem.latestLog(instance))
    return
  }

  json(response, 405, {
    error: "Method not allowed",
    code: "method_not_allowed",
  })
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

function authorize(response: ServerResponse): boolean {
  json(response, 426, {
    error: "Relay control operations require kiln-relay.v1 WebSocket transport",
    code: "websocket_required",
  })
  return false
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

function writeStreamChunk(
  response: ServerResponse,
  chunk: string,
  signal: AbortSignal
): Promise<boolean> {
  if (signal.aborted || response.destroyed || response.writableEnded) {
    return Promise.resolve(false)
  }
  if (response.write(chunk)) return Promise.resolve(true)

  return new Promise((resolvePromise) => {
    const cleanup = () => {
      response.off("drain", drained)
      response.off("close", closed)
      response.off("error", closed)
      signal.removeEventListener("abort", closed)
    }
    const drained = () => {
      cleanup()
      resolvePromise(true)
    }
    const closed = () => {
      cleanup()
      resolvePromise(false)
    }

    response.once("drain", drained)
    response.once("close", closed)
    response.once("error", closed)
    signal.addEventListener("abort", closed, { once: true })
  })
}
