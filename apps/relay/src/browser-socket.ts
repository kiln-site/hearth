import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
} from "node:crypto"
import type { ReadStream } from "node:fs"
import { Schema } from "effect"
import { WebSocket, WebSocketServer } from "ws"
import * as Sentry from "@sentry/node"

import {
  relayBrowserProofTranscript,
  relayBrowserRequestProofTranscript,
  relayBrowserProtocol,
} from "@workspace/contracts"
import type { RelayConsoleLine } from "@workspace/contracts"
import {
  relayConsoleCommandSchema,
  relayConsoleCompletionInputSchema,
} from "@workspace/contracts"

import type { DockerDriver } from "./docker.js"
import type { FilesystemDriver } from "./files.js"
import type { RelayInstanceConfig } from "./config.js"
import type { RelayIdentity } from "./effect/identity.js"
import type { RelayClientGrant, RelayStateStore } from "./effect/state.js"
import type { RelaySnapshotSample } from "./snapshot-hub.js"
import type { Effect } from "effect"
import type { Server } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"

const AUTHENTICATION_WINDOW_MS = 10_000
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024
const HTTP_PROOF_WINDOW_MS = 30_000
const MAX_BROWSER_SESSIONS = 512
const MAX_DIRECT_TRANSFERS = 32
const MAX_DIRECT_TRANSFERS_PER_CLIENT = 8

const BrowserAuthSchema = Schema.Struct({
  capability: Schema.String,
  publicKeyJwk: Schema.Struct({
    crv: Schema.Literal("P-256"),
    kty: Schema.Literal("EC"),
    x: Schema.String,
    y: Schema.String,
  }),
  signature: Schema.String,
  type: Schema.Literal("auth"),
  v: Schema.Literal(1),
})

const BrowserPublicKeySchema = BrowserAuthSchema.fields.publicKeyJwk

const BrowserSubscribeSchema = Schema.Struct({
  instanceId: Schema.String,
  type: Schema.Literal("console.subscribe"),
  v: Schema.Literal(1),
})

const BrowserResourceSubscribeSchema = Schema.Struct({
  instanceId: Schema.String,
  type: Schema.Literal("resource.subscribe"),
  v: Schema.Literal(1),
})

const BrowserConsoleWriteSchema = Schema.Struct({
  command: Schema.String,
  instanceId: Schema.String,
  requestId: Schema.String,
  type: Schema.Literal("console.write"),
  v: Schema.Literal(1),
})

const BrowserConsoleCompleteSchema = Schema.Struct({
  cursor: Schema.Number,
  input: Schema.String,
  instanceId: Schema.String,
  requestId: Schema.String,
  type: Schema.Literal("console.complete"),
  v: Schema.Literal(1),
})

const CapabilitySchema = Schema.Struct({
  actions: Schema.Array(Schema.String),
  audience: Schema.String,
  capabilityId: Schema.String,
  expiresAt: Schema.Number,
  instanceId: Schema.String,
  issuedAt: Schema.Number,
  issuer: Schema.String,
  keyThumbprint: Schema.String,
  origin: Schema.String,
  path: Schema.NullOr(Schema.String),
  subject: Schema.String,
  version: Schema.Literal(1),
})

type BrowserCapability = typeof CapabilitySchema.Type

export interface BrowserSocketOptions {
  readonly docker: DockerDriver
  readonly filesystem: FilesystemDriver
  readonly identity: RelayIdentity
  readonly runEffect: <T, E>(effect: Effect.Effect<T, E>) => Promise<T>
  readonly server: Server
  readonly state: RelayStateStore["Service"]
  readonly subscribeSnapshots: (
    listener: (sample: RelaySnapshotSample) => void
  ) => () => void
}

export interface BrowserSocketServer {
  readonly close: () => Promise<void>
  readonly handleRequest: (
    request: IncomingMessage,
    response: ServerResponse
  ) => Promise<boolean>
  readonly revokeClient: (clientId: string) => void
}

export function attachBrowserSocket(
  options: BrowserSocketOptions
): BrowserSocketServer {
  const sockets = new Set<WebSocket>()
  const socketIssuers = new Map<WebSocket, string>()
  const requestProofs = new Map<string, number>()
  const pendingRequestProofs = new Set<string>()
  const transfers = { active: 0, byClient: new Map<string, number>() }
  const hubs = new ConsoleHubRegistry(options.docker)
  const resourceHubs = new ResourceHubRegistry(options.subscribeSnapshots)
  const wss = new WebSocketServer({
    clientTracking: false,
    handleProtocols: (protocols) =>
      protocols.has(relayBrowserProtocol) ? relayBrowserProtocol : false,
    maxPayload: 64 * 1024,
    noServer: true,
    perMessageDeflate: false,
  })

  options.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://relay")
    if (url.pathname !== "/v1/browser") return
    if (
      !parseProtocols(request.headers["sec-websocket-protocol"]).includes(
        relayBrowserProtocol
      )
    ) {
      socket.write("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n")
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit("connection", webSocket, request)
    })
  })

  wss.on("connection", (socket, request) => {
    if (sockets.size >= MAX_BROWSER_SESSIONS) {
      socket.close(1013, "Relay browser session capacity reached")
      return
    }
    const origin = request.headers.origin
    if (!origin) {
      socket.close(4403, "Browser origin is required")
      return
    }
    sockets.add(socket)
    authenticateBrowser(
      socket,
      origin,
      options,
      hubs,
      resourceHubs,
      (clientId) => {
        socketIssuers.set(socket, clientId)
      }
    )
    socket.once("close", () => {
      sockets.delete(socket)
      socketIssuers.delete(socket)
      hubs.remove(socket)
      resourceHubs.remove(socket)
    })
  })

  return {
    close: async () => {
      hubs.close()
      resourceHubs.close()
      await closeSockets(sockets, "Relay shutting down")
      await new Promise<void>((resolve) => wss.close(() => resolve()))
    },
    handleRequest: (request, response) =>
      handleBrowserFileRequest(
        request,
        response,
        options,
        pendingRequestProofs,
        requestProofs,
        transfers
      ),
    revokeClient: (clientId) => {
      for (const [socket, issuer] of socketIssuers) {
        if (issuer === clientId) socket.close(4403, "Capability issuer changed")
      }
    },
  }
}

function authenticateBrowser(
  socket: WebSocket,
  origin: string,
  options: BrowserSocketOptions,
  hubs: ConsoleHubRegistry,
  resourceHubs: ResourceHubRegistry,
  onAuthenticated: (clientId: string) => void
): void {
  const challenge = {
    expiresAt: Date.now() + AUTHENTICATION_WINDOW_MS,
    nonce: randomBytes(32).toString("base64url"),
    relayId: options.identity.fingerprint,
    sessionId: randomUUID(),
    type: "auth.challenge",
    v: 1,
  }
  send(socket, challenge)
  let capability: BrowserCapability | null = null
  const timer = setTimeout(() => {
    if (!capability) socket.close(4401, "Browser authentication timed out")
  }, AUTHENTICATION_WINDOW_MS)
  timer.unref()
  let capabilityTimer: ReturnType<typeof setTimeout> | null = null

  socket.on("message", (data, binary) => {
    if (binary) {
      socket.close(4400, "Binary browser frames are not supported")
      return
    }
    let input: unknown
    try {
      input = JSON.parse(data.toString()) as unknown
    } catch {
      socket.close(4400, "Invalid browser message")
      return
    }
    if (!capability) {
      void authenticate(input).catch(() =>
        socket.close(4401, "Browser authentication failed")
      )
      return
    }
    try {
      const subscription = Schema.decodeUnknownSync(BrowserSubscribeSchema)(
        input
      )
      if (
        subscription.instanceId !== capability.instanceId ||
        !capability.actions.includes("instance.console.read")
      ) {
        socket.close(4403, "Console capability does not allow this instance")
        return
      }
      void hubs
        .subscribe(socket, subscription.instanceId)
        .catch(() => socket.close(4500, "Console stream failed"))
      return
    } catch {
      // Try the other supported subscription shape below.
    }
    try {
      const subscription = Schema.decodeUnknownSync(
        BrowserResourceSubscribeSchema
      )(input)
      if (
        subscription.instanceId !== capability.instanceId ||
        !capability.actions.includes("instance.read")
      ) {
        socket.close(4403, "Resource capability does not allow this instance")
        return
      }
      resourceHubs.subscribe(socket, subscription.instanceId)
      return
    } catch {
      // Try the supported console operations below.
    }
    try {
      const request = Schema.decodeUnknownSync(BrowserConsoleWriteSchema)(input)
      if (
        request.instanceId !== capability.instanceId ||
        !capability.actions.includes("instance.console.write")
      ) {
        socket.close(4403, "Console capability does not allow writes")
        return
      }
      void executeConsoleWrite(socket, request, options, capability)
      return
    } catch {
      // Try command completion below.
    }
    try {
      const request = Schema.decodeUnknownSync(BrowserConsoleCompleteSchema)(
        input
      )
      if (
        request.instanceId !== capability.instanceId ||
        !capability.actions.includes("instance.console.write")
      ) {
        socket.close(4403, "Console capability does not allow completion")
        return
      }
      void executeConsoleCompletion(socket, request, options.docker)
    } catch {
      socket.close(4400, "Invalid browser operation")
    }
  })

  socket.once("close", () => {
    clearTimeout(timer)
    if (capabilityTimer) clearTimeout(capabilityTimer)
  })

  async function authenticate(value: unknown): Promise<void> {
    if (Date.now() > challenge.expiresAt || capability) {
      throw new Error("Browser challenge expired")
    }
    const auth = Schema.decodeUnknownSync(BrowserAuthSchema)(value)
    const parsed = decodeCapability(auth.capability)
    const client = await options.runEffect(
      options.state.findClientById(parsed.payload.issuer)
    )
    if (!client) throw new Error("Capability issuer was revoked")
    validateCapability(
      parsed,
      client,
      origin,
      options.identity.fingerprint,
      null
    )
    if (
      browserKeyThumbprint(auth.publicKeyJwk) !== parsed.payload.keyThumbprint
    ) {
      throw new Error("Browser key does not match capability")
    }
    const browserKey = createPublicKey({
      format: "jwk",
      key: auth.publicKeyJwk,
    })
    const validProof = verify(
      "sha256",
      Buffer.from(
        relayBrowserProofTranscript({
          capabilityId: parsed.payload.capabilityId,
          expiresAt: challenge.expiresAt,
          nonce: challenge.nonce,
          relayId: challenge.relayId,
          sessionId: challenge.sessionId,
        })
      ),
      { dsaEncoding: "ieee-p1363", key: browserKey },
      Buffer.from(auth.signature, "base64url")
    )
    if (!validProof) throw new Error("Browser proof is invalid")
    capability = parsed.payload
    onAuthenticated(client.id)
    clearTimeout(timer)
    capabilityTimer = setTimeout(
      () => socket.close(4401, "Browser capability expired"),
      Math.max(1, capability.expiresAt - Date.now())
    )
    capabilityTimer.unref()
    send(socket, {
      expiresAt: capability.expiresAt,
      instanceId: capability.instanceId,
      type: "auth.ready",
      v: 1,
    })
  }
}

async function executeConsoleWrite(
  socket: WebSocket,
  request: typeof BrowserConsoleWriteSchema.Type,
  options: BrowserSocketOptions,
  capability: BrowserCapability
): Promise<void> {
  try {
    const instance = await options.docker.findInstance(request.instanceId)
    if (!instance) throw new Error("Instance not found")
    const input = relayConsoleCommandSchema.parse({ command: request.command })
    await options.docker.sendCommand(instance, input.command)
    void auditBrowserConsoleWrite(options, capability, instance.id)
    send(socket, {
      operation: "console.write",
      payload: { accepted: true, command: input.command },
      requestId: request.requestId,
      type: "operation.result",
    })
  } catch {
    send(socket, {
      code: "console_write_failed",
      message: "Command could not be sent",
      requestId: request.requestId,
      type: "operation.error",
    })
  }
}

async function auditBrowserConsoleWrite(
  options: BrowserSocketOptions,
  capability: BrowserCapability,
  instanceId: string
): Promise<void> {
  try {
    await options.runEffect(
      options.state.appendAudit({
        clientId: capability.issuer,
        details: { instanceId, subject: capability.subject },
        event: "browser.console.write",
        id: randomUUID(),
        occurredAt: Date.now(),
        requestId: capability.capabilityId,
      })
    )
  } catch (cause) {
    Sentry.captureException(cause, {
      tags: { "kiln.operation": "browser.console.audit" },
    })
  }
}

async function executeConsoleCompletion(
  socket: WebSocket,
  request: typeof BrowserConsoleCompleteSchema.Type,
  docker: DockerDriver
): Promise<void> {
  try {
    const instance = await docker.findInstance(request.instanceId)
    if (!instance) throw new Error("Instance not found")
    const input = relayConsoleCompletionInputSchema.parse(request)
    const payload = await docker.completeCommand(
      instance,
      input.input,
      input.cursor
    )
    send(socket, {
      operation: "console.complete",
      payload,
      requestId: request.requestId,
      type: "operation.result",
    })
  } catch {
    send(socket, {
      code: "console_completion_failed",
      message: "Completions are unavailable",
      requestId: request.requestId,
      type: "operation.error",
    })
  }
}

function decodeCapability(value: string): {
  encoded: string
  payload: BrowserCapability
  signature: string
} {
  const [encoded, signature, extra] = value.split(".")
  if (!encoded || !signature || extra) throw new Error("Invalid capability")
  return {
    encoded,
    payload: Schema.decodeUnknownSync(CapabilitySchema)(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown
    ),
    signature,
  }
}

function validateCapability(
  capability: ReturnType<typeof decodeCapability>,
  client: RelayClientGrant,
  origin: string,
  relayId: string,
  requiredAction: string | null
): void {
  if (
    capability.payload.audience !== relayId ||
    capability.payload.expiresAt <= Date.now() ||
    capability.payload.issuedAt > Date.now() + 5_000 ||
    capability.payload.origin !== origin ||
    !client.origins.includes(origin) ||
    capability.payload.actions.length === 0 ||
    (requiredAction !== null && !client.actions.includes(requiredAction)) ||
    (requiredAction !== null &&
      !capability.payload.actions.includes(requiredAction)) ||
    capability.payload.actions.some(
      (action) => !client.actions.includes(action)
    ) ||
    !verify(
      null,
      Buffer.from(capability.encoded),
      client.publicKey,
      Buffer.from(capability.signature, "base64url")
    )
  ) {
    throw new Error("Browser capability is invalid")
  }
}

async function handleBrowserFileRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: BrowserSocketOptions,
  pendingRequestProofs: Set<string>,
  requestProofs: Map<string, number>,
  transfers: { active: number; byClient: Map<string, number> }
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://relay")
  const match = url.pathname.match(/^\/v1\/browser\/files\/([^/]+)$/u)
  if (!match) return false
  const origin = request.headers.origin
  if (!origin) {
    browserJson(response, 403, { error: "Browser origin is required" })
    return true
  }
  if (request.method === "OPTIONS") {
    const clients = await options.runEffect(options.state.listClients())
    if (!clients.some((client) => client.origins.includes(origin))) {
      browserJson(response, 403, { error: "Browser origin is not paired" })
      return true
    }
    response
      .writeHead(
        204,
        browserCorsHeaders(origin, {
          "Access-Control-Allow-Headers": [
            "Authorization",
            "Content-Type",
            "X-Kiln-Nonce",
            "X-Kiln-Proof",
            "X-Kiln-Public-Key",
            "X-Kiln-Requested-At",
          ].join(", "),
          "Access-Control-Allow-Methods": "GET, HEAD, PUT, OPTIONS",
          "Access-Control-Max-Age": "600",
        })
      )
      .end()
    return true
  }
  const method = request.method
  if (method !== "GET" && method !== "HEAD" && method !== "PUT") {
    browserJson(response, 405, { error: "Method not allowed" }, origin)
    return true
  }
  const instanceId = decodeURIComponent(match[1])
  const path = url.searchParams.get("path") ?? ""
  let authentication: Awaited<ReturnType<typeof authenticateBrowserRequest>>
  try {
    authentication = await authenticateBrowserRequest({
      instanceId,
      method,
      options,
      origin,
      path,
      request,
      pendingRequestProofs,
      requestProofs,
    })
  } catch {
    browserJson(
      response,
      401,
      { error: "Browser capability is invalid" },
      origin
    )
    return true
  }

  const clientId = authentication.clientId
  const clientTransfers = transfers.byClient.get(clientId) ?? 0
  if (
    transfers.active >= MAX_DIRECT_TRANSFERS ||
    clientTransfers >= MAX_DIRECT_TRANSFERS_PER_CLIENT
  ) {
    browserJson(
      response,
      429,
      { error: "Relay file transfer capacity reached" },
      origin
    )
    return true
  }
  transfers.active += 1
  transfers.byClient.set(clientId, clientTransfers + 1)

  try {
    const instance = await options.docker.findInstance(instanceId)
    if (!instance) {
      browserJson(response, 404, { error: "Instance not found" }, origin)
      return true
    }
    if (method === "PUT") {
      const uploaded = await options.filesystem.upload(instance, path, request)
      void auditBrowserTransfer(options, authentication, method, uploaded.size)
      browserJson(response, 200, uploaded, origin)
      return true
    }
    const download = await options.filesystem.download(instance, path)
    try {
      const range = parseRange(request.headers.range, download.size)
      const headers = browserCorsHeaders(origin, {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Disposition": contentDisposition(download.name),
        "Content-Length": String(
          range ? range.end - range.start + 1 : download.size
        ),
        "Content-Type": "application/octet-stream",
        "Last-Modified": new Date(download.modifiedAt).toUTCString(),
        "X-Content-Type-Options": "nosniff",
      })
      if (range)
        headers["Content-Range"] =
          `bytes ${range.start}-${range.end}/${download.size}`
      response.writeHead(range ? 206 : 200, headers)
      if (method === "HEAD") {
        response.end()
        void auditBrowserTransfer(
          options,
          authentication,
          method,
          0,
          "completed"
        )
        return true
      }
      const streamOptions = range
        ? { autoClose: false, end: range.end, start: range.start }
        : { autoClose: false }
      const result = await streamDownload(
        download.file.createReadStream(streamOptions),
        response
      )
      void auditBrowserTransfer(
        options,
        authentication,
        method,
        result.bytes,
        result.completed ? "completed" : "aborted"
      )
    } finally {
      await download.file.close()
    }
  } catch (cause) {
    Sentry.captureException(cause, {
      tags: {
        "kiln.operation":
          method === "PUT" ? "browser.file.upload" : "browser.file.download",
        "kiln.relay_id": options.identity.fingerprint,
      },
    })
    if (response.headersSent) {
      response.destroy(cause instanceof Error ? cause : undefined)
    } else {
      browserJson(response, 400, { error: safeBrowserError(cause) }, origin)
    }
  } finally {
    transfers.active -= 1
    const remaining = (transfers.byClient.get(clientId) ?? 1) - 1
    if (remaining > 0) transfers.byClient.set(clientId, remaining)
    else transfers.byClient.delete(clientId)
  }
  return true
}

async function authenticateBrowserRequest(input: {
  instanceId: string
  method: "GET" | "HEAD" | "PUT"
  options: BrowserSocketOptions
  origin: string
  path: string
  request: IncomingMessage
  pendingRequestProofs: Set<string>
  requestProofs: Map<string, number>
}): Promise<{ capabilityId: string; clientId: string; subject: string }> {
  const authorization = header(input.request, "authorization")
  if (!authorization.startsWith("Kiln ")) throw new Error("Missing capability")
  const parsed = decodeCapability(authorization.slice(5))
  const requiredAction =
    input.method === "PUT" ? "instance.files.upload" : "instance.files.download"
  const publicKeyJwk = Schema.decodeUnknownSync(BrowserPublicKeySchema)(
    JSON.parse(
      Buffer.from(
        header(input.request, "x-kiln-public-key"),
        "base64url"
      ).toString("utf8")
    ) as unknown
  )
  if (browserKeyThumbprint(publicKeyJwk) !== parsed.payload.keyThumbprint) {
    throw new Error("Browser key does not match capability")
  }
  const requestedAt = Number(header(input.request, "x-kiln-requested-at"))
  const nonce = header(input.request, "x-kiln-nonce")
  if (
    !Number.isSafeInteger(requestedAt) ||
    Math.abs(Date.now() - requestedAt) > HTTP_PROOF_WINDOW_MS ||
    Buffer.from(nonce, "base64url").length < 16
  )
    throw new Error("Browser proof freshness is invalid")
  for (const [key, expiresAt] of input.requestProofs) {
    if (expiresAt <= Date.now()) input.requestProofs.delete(key)
  }
  const replayKey = `${parsed.payload.capabilityId}:${nonce}`
  if (
    input.requestProofs.has(replayKey) ||
    input.pendingRequestProofs.has(replayKey)
  )
    throw new Error("Browser proof was replayed")
  input.pendingRequestProofs.add(replayKey)
  try {
    const client = await input.options.runEffect(
      input.options.state.findClientById(parsed.payload.issuer)
    )
    if (!client) throw new Error("Capability issuer was revoked")
    validateCapability(
      parsed,
      client,
      input.origin,
      input.options.identity.fingerprint,
      requiredAction
    )
    if (
      parsed.payload.instanceId !== input.instanceId ||
      parsed.payload.path !== input.path
    )
      throw new Error("Capability scope does not match the file")

    const browserKey = createPublicKey({ format: "jwk", key: publicKeyJwk })
    const proof = Buffer.from(
      header(input.request, "x-kiln-proof"),
      "base64url"
    )
    const valid = verify(
      "sha256",
      Buffer.from(
        relayBrowserRequestProofTranscript({
          capabilityId: parsed.payload.capabilityId,
          expiresAt: parsed.payload.expiresAt,
          instanceId: input.instanceId,
          method: input.method,
          nonce,
          path: input.path,
          relayId: input.options.identity.fingerprint,
          requestedAt,
        })
      ),
      { dsaEncoding: "ieee-p1363", key: browserKey },
      proof
    )
    if (!valid) throw new Error("Browser request proof is invalid")
    input.requestProofs.set(replayKey, parsed.payload.expiresAt)
    return {
      capabilityId: parsed.payload.capabilityId,
      clientId: client.id,
      subject: parsed.payload.subject,
    }
  } finally {
    input.pendingRequestProofs.delete(replayKey)
  }
}

async function auditBrowserTransfer(
  options: BrowserSocketOptions,
  authentication: {
    capabilityId: string
    clientId: string
    subject: string
  },
  method: "GET" | "HEAD" | "PUT",
  bytes: number,
  outcome: "aborted" | "completed" = "completed"
): Promise<void> {
  try {
    await options.runEffect(
      options.state.appendAudit({
        clientId: authentication.clientId,
        details: {
          bytes,
          method,
          outcome,
          subject: authentication.subject,
        },
        event:
          method === "PUT" ? "browser.file.upload" : "browser.file.download",
        id: randomUUID(),
        occurredAt: Date.now(),
        requestId: authentication.capabilityId,
      })
    )
  } catch (cause) {
    Sentry.captureException(cause, {
      tags: { "kiln.operation": "browser.file.audit" },
    })
  }
}

function header(request: IncomingMessage, name: string): string {
  const value = request.headers[name]
  if (typeof value !== "string" || !value || value.length > 8_192) {
    throw new Error(`${name} header is invalid`)
  }
  return value
}

function browserCorsHeaders(
  origin: string,
  extra: Record<string, string> = {}
): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Expose-Headers":
      "Content-Disposition, Content-Length, Content-Range",
    Vary: "Origin",
    ...extra,
  }
}

function browserJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  origin?: string
): void {
  if (response.destroyed || response.writableEnded) return
  response
    .writeHead(status, {
      ...(origin ? browserCorsHeaders(origin) : {}),
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    })
    .end(JSON.stringify(value))
}

export function parseRange(
  value: string | undefined,
  size: number
): { end: number; start: number } | null {
  if (!value) return null
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("Requested byte range is invalid")
  }
  const match = value.match(/^bytes=(\d*)-(\d*)$/u)
  if (!match) throw new Error("Only a single byte range is supported")
  if (!match[1] && !match[2]) throw new Error("Requested byte range is invalid")
  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new Error("Requested byte range is invalid")
    }
    return { end: size - 1, start: Math.max(0, size - suffixLength) }
  }
  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  const end = Math.min(requestedEnd, size - 1)
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    throw new Error("Requested byte range is invalid")
  }
  return { end, start }
}

function contentDisposition(name: string): string {
  const fallback = name.replace(/[^A-Za-z0-9._-]/gu, "_") || "download"
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

function streamDownload(
  stream: ReadStream,
  response: ServerResponse
): Promise<{ bytes: number; completed: boolean }> {
  return new Promise((resolveStream, reject) => {
    let bytes = 0
    const cleanup = () => {
      stream.off("error", failed)
      stream.off("data", received)
      response.off("finish", finished)
      response.off("close", closed)
    }
    const received = (chunk: Buffer | string) => {
      bytes += Buffer.byteLength(chunk)
    }
    const failed = (cause: Error) => {
      cleanup()
      reject(cause)
    }
    const finished = () => {
      cleanup()
      resolveStream({ bytes, completed: true })
    }
    const closed = () => {
      stream.destroy()
      cleanup()
      resolveStream({ bytes, completed: false })
    }
    stream.once("error", failed)
    stream.on("data", received)
    response.once("finish", finished)
    response.once("close", closed)
    stream.pipe(response)
  })
}

function safeBrowserError(cause: unknown): string {
  if (!cause || typeof cause !== "object" || !("message" in cause)) {
    return "File transfer failed"
  }
  const message = cause.message
  return typeof message === "string" && message.length <= 200
    ? message
    : "File transfer failed"
}

class ConsoleHubRegistry {
  readonly #docker: DockerDriver
  readonly #hubs = new Map<string, ConsoleHub>()
  readonly #pendingHubs = new Map<string, Promise<ConsoleHub>>()
  readonly #subscriptions = new Map<WebSocket, string>()

  constructor(docker: DockerDriver) {
    this.#docker = docker
  }

  async subscribe(socket: WebSocket, instanceId: string): Promise<void> {
    this.remove(socket)
    this.#subscriptions.set(socket, instanceId)
    let hub = this.#hubs.get(instanceId)
    if (!hub) {
      let pending = this.#pendingHubs.get(instanceId)
      if (!pending) {
        pending = this.#createHub(instanceId)
        this.#pendingHubs.set(instanceId, pending)
      }
      try {
        hub = await pending
      } finally {
        if (this.#pendingHubs.get(instanceId) === pending) {
          this.#pendingHubs.delete(instanceId)
        }
      }
    }
    if (
      this.#subscriptions.get(socket) !== instanceId ||
      socket.readyState !== WebSocket.OPEN
    ) {
      const hasWaitingSubscriber = [...this.#subscriptions.values()].some(
        (subscribedInstanceId) => subscribedInstanceId === instanceId
      )
      if (hub.subscriberCount === 0 && !hasWaitingSubscriber) hub.close()
      return
    }
    hub.add(socket)
  }

  remove(socket: WebSocket): void {
    const instanceId = this.#subscriptions.get(socket)
    if (!instanceId) return
    this.#subscriptions.delete(socket)
    this.#hubs.get(instanceId)?.remove(socket)
  }

  close(): void {
    for (const hub of this.#hubs.values()) hub.close()
    this.#hubs.clear()
    this.#subscriptions.clear()
  }

  async #createHub(instanceId: string): Promise<ConsoleHub> {
    const instance = await this.#docker.findInstance(instanceId)
    if (!instance) throw new Error("Instance not found")
    const hub = new ConsoleHub(this.#docker, instance, () => {
      if (hub.subscriberCount === 0) this.#hubs.delete(instanceId)
    })
    this.#hubs.set(instanceId, hub)
    return hub
  }
}

class ResourceHubRegistry {
  readonly #subscribeSnapshots: BrowserSocketOptions["subscribeSnapshots"]
  readonly #subscriptions = new Map<WebSocket, string>()
  #unsubscribe: (() => void) | null = null

  constructor(subscribeSnapshots: BrowserSocketOptions["subscribeSnapshots"]) {
    this.#subscribeSnapshots = subscribeSnapshots
  }

  subscribe(socket: WebSocket, instanceId: string): void {
    this.#subscriptions.set(socket, instanceId)
    this.#unsubscribe ??= this.#subscribeSnapshots((sample) => {
      const byId = new Map(
        sample.snapshot.instances.map((instance) => [instance.id, instance])
      )
      for (const [subscriber, subscribedInstanceId] of this.#subscriptions) {
        const instance = byId.get(subscribedInstanceId)
        if (instance) {
          send(subscriber, {
            instance,
            sequence: sample.sequence,
            type: "resource",
          })
        }
      }
    })
  }

  remove(socket: WebSocket): void {
    this.#subscriptions.delete(socket)
    if (this.#subscriptions.size === 0) {
      this.#unsubscribe?.()
      this.#unsubscribe = null
    }
  }

  close(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = null
    this.#subscriptions.clear()
  }
}

class ConsoleHub {
  readonly #abort = new AbortController()
  readonly #docker: DockerDriver
  readonly #instance: RelayInstanceConfig
  readonly #onEmpty: () => void
  readonly #recent: Array<RelayConsoleLine> = []
  readonly #subscribers = new Set<WebSocket>()
  #graceTimer: ReturnType<typeof setTimeout> | null = null
  #retryTimer: ReturnType<typeof setTimeout> | null = null
  #started = false

  constructor(
    docker: DockerDriver,
    instance: NonNullable<Awaited<ReturnType<DockerDriver["findInstance"]>>>,
    onEmpty: () => void
  ) {
    this.#docker = docker
    this.#instance = instance
    this.#onEmpty = onEmpty
  }

  get subscriberCount(): number {
    return this.#subscribers.size
  }

  add(socket: WebSocket): void {
    if (this.#graceTimer) clearTimeout(this.#graceTimer)
    if (this.#retryTimer) clearTimeout(this.#retryTimer)
    this.#graceTimer = null
    this.#retryTimer = null
    this.#subscribers.add(socket)
    send(socket, { type: "ready", instanceId: this.#instance.id })
    for (const line of this.#recent) send(socket, { type: "line", line })
    if (!this.#started) {
      this.#started = true
      void this.#run()
    }
  }

  remove(socket: WebSocket): void {
    this.#subscribers.delete(socket)
    if (this.#subscribers.size > 0 || this.#graceTimer) return
    this.#graceTimer = setTimeout(() => {
      if (this.#subscribers.size === 0) this.close()
    }, 2_000)
    this.#graceTimer.unref()
  }

  close(): void {
    if (this.#graceTimer) clearTimeout(this.#graceTimer)
    if (this.#retryTimer) clearTimeout(this.#retryTimer)
    this.#graceTimer = null
    this.#retryTimer = null
    this.#abort.abort()
    this.#onEmpty()
  }

  async #run(): Promise<void> {
    try {
      for await (const line of this.#docker.streamConsole(
        this.#instance,
        this.#abort.signal
      )) {
        this.#recent.push(line)
        if (this.#recent.length > 5_000) this.#recent.shift()
        const encoded = JSON.stringify({ type: "line", line })
        for (const socket of this.#subscribers) sendEncoded(socket, encoded)
      }
    } catch (cause) {
      if (!this.#abort.signal.aborted) {
        Sentry.captureException(cause, {
          tags: { "kiln.operation": "browser.console.stream" },
        })
      }
    } finally {
      this.#started = false
      if (this.#subscribers.size === 0 || this.#abort.signal.aborted) {
        this.#onEmpty()
      } else {
        this.#retryTimer = setTimeout(() => {
          this.#retryTimer = null
          if (this.#subscribers.size > 0 && !this.#started) {
            this.#started = true
            void this.#run()
          }
        }, 1_000)
        this.#retryTimer.unref()
      }
    }
  }
}

function browserKeyThumbprint(jwk: {
  readonly crv: "P-256"
  readonly kty: "EC"
  readonly x: string
  readonly y: string
}): string {
  return createHash("sha256")
    .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))
    .digest("base64url")
}

async function closeSockets(
  sockets: ReadonlySet<WebSocket>,
  reason: string
): Promise<void> {
  await Promise.all(
    [...sockets].map(
      (socket) =>
        new Promise<void>((resolveClose) => {
          if (socket.readyState === WebSocket.CLOSED) {
            resolveClose()
            return
          }
          const timer = setTimeout(() => {
            socket.terminate()
          }, 1_000)
          timer.unref()
          socket.once("close", () => {
            clearTimeout(timer)
            resolveClose()
          })
          socket.close(1001, reason)
        })
    )
  )
}

function send(socket: WebSocket, value: unknown): void {
  sendEncoded(socket, JSON.stringify(value))
}

function sendEncoded(socket: WebSocket, value: string): void {
  if (socket.readyState !== WebSocket.OPEN) return
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
    socket.close(1013, "Browser is not consuming console data")
    return
  }
  socket.send(value)
}

function parseProtocols(value: string | undefined): ReadonlyArray<string> {
  return value?.split(",").map((protocol) => protocol.trim()) ?? []
}
