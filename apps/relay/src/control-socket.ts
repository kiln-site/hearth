import {
  createPublicKey,
  randomBytes,
  randomUUID,
  sign,
  verify,
} from "node:crypto"
import { Schema } from "effect"
import type { Effect } from "effect"
import { WebSocket, WebSocketServer } from "ws"
import * as Sentry from "@sentry/node"

import {
  RelayControlClientMessageSchema,
  relayAuthChallengeTranscript,
  relayAuthResponseTranscript,
  relayControlProtocol,
} from "@workspace/contracts"
import type {
  RelayAuthChallenge,
  RelayAuthReady,
  RelayControlError,
  RelayControlEvent,
  RelayControlRequest,
  RelayControlResponse,
  RelayControlOperation,
} from "@workspace/contracts"

import { isActionAllowed } from "./permissions.js"
import { isSourceAllowed } from "./source-policy.js"
import type { RelayAction } from "./permissions.js"
import type { RelayIdentity } from "./effect/identity.js"
import type { RelayClientGrant, RelayStateStore } from "./effect/state.js"
import type { Server } from "node:http"

const AUTHENTICATION_WINDOW_MS = 10_000
const HEARTBEAT_INTERVAL_MS = 15_000
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024
const MAX_IN_FLIGHT_REQUESTS = 32
const MAX_REQUEST_DEADLINE_MS = 30_000
const MAX_CONTROL_SESSIONS = 128
const MAX_CONTROL_SESSIONS_PER_CLIENT = 4

export interface ControlSocketOptions {
  readonly execute: (
    request: RelayControlRequest,
    client: RelayClientGrant,
    signal: AbortSignal
  ) => Promise<unknown>
  readonly identity: RelayIdentity
  readonly initialSnapshot: () => Promise<unknown>
  readonly subscribeSnapshots: (
    listener: (snapshot: unknown) => void
  ) => () => void
  readonly runEffect: <T, E>(effect: Effect.Effect<T, E>) => Promise<T>
  readonly server: Server
  readonly state: RelayStateStore["Service"]
}

export interface ControlSocketServer {
  readonly close: () => Promise<void>
  readonly requestClients: (
    operation: RelayControlOperation,
    payload: unknown,
    timeoutMs?: number
  ) => Promise<ReadonlyArray<{ clientId: string; payload: unknown }>>
  readonly refreshClient: (clientId: string) => void
  readonly revokeClient: (clientId: string) => void
  readonly sessions: ReadonlyMap<string, RelayClientGrant>
}

export function attachControlSocket(
  options: ControlSocketOptions
): ControlSocketServer {
  const sessions = new Map<string, RelayClientGrant>()
  const sockets = new Set<WebSocket>()
  const socketSessions = new WeakMap<WebSocket, string>()
  const authenticatedSockets = new Map<WebSocket, RelayClientGrant>()
  const reverseRequesters = new Map<
    WebSocket,
    (
      operation: RelayControlOperation,
      payload: unknown,
      timeoutMs: number
    ) => Promise<unknown>
  >()
  const wss = new WebSocketServer({
    clientTracking: false,
    maxPayload: 1024 * 1024,
    noServer: true,
    perMessageDeflate: false,
    handleProtocols: (protocols) =>
      protocols.has(relayControlProtocol) ? relayControlProtocol : false,
  })

  options.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://relay")
    if (url.pathname !== "/v1/socket") return
    const protocols = parseProtocols(request.headers["sec-websocket-protocol"])
    if (!protocols.includes(relayControlProtocol)) {
      socket.write("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n")
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit("connection", webSocket, request)
    })
  })

  wss.on("connection", (socket, request) => {
    if (sockets.size >= MAX_CONTROL_SESSIONS) {
      socket.close(1013, "Relay control session capacity reached")
      return
    }
    sockets.add(socket)
    authenticateSocket(
      socket,
      options,
      sessions,
      socketSessions,
      authenticatedSockets,
      reverseRequesters,
      request.socket.remoteAddress
    )
    socket.once("close", () => {
      sockets.delete(socket)
      const sessionId = socketSessions.get(socket)
      if (sessionId) sessions.delete(sessionId)
      authenticatedSockets.delete(socket)
      reverseRequesters.delete(socket)
    })
  })

  const heartbeat = setInterval(() => {
    for (const socket of sockets) {
      const tracked = socket as TrackedWebSocket
      if (tracked.kilnAlive === false) {
        socket.terminate()
        continue
      }
      tracked.kilnAlive = false
      socket.ping()
    }
  }, HEARTBEAT_INTERVAL_MS)
  heartbeat.unref()

  return {
    close: async () => {
      clearInterval(heartbeat)
      for (const socket of sockets) socket.close(1001, "Relay shutting down")
      await new Promise<void>((resolve) => wss.close(() => resolve()))
    },
    requestClients: async (operation, payload, timeoutMs = 5_000) => {
      const requests = [...reverseRequesters.entries()].map(
        async ([socket, request]) => ({
          clientId: authenticatedSockets.get(socket)?.id ?? "unknown",
          payload: await request(operation, payload, timeoutMs),
        })
      )
      const settled = await Promise.allSettled(requests)
      return settled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      )
    },
    refreshClient: (clientId) => {
      closeClientSockets(
        authenticatedSockets,
        clientId,
        "Hearth client policy changed"
      )
    },
    revokeClient: (clientId) => {
      closeClientSockets(
        authenticatedSockets,
        clientId,
        "Hearth client was revoked"
      )
    },
    sessions,
  }
}

interface TrackedWebSocket extends WebSocket {
  kilnAlive?: boolean
}

function authenticateSocket(
  socket: WebSocket,
  options: ControlSocketOptions,
  sessions: Map<string, RelayClientGrant>,
  socketSessions: WeakMap<WebSocket, string>,
  authenticatedSockets: Map<WebSocket, RelayClientGrant>,
  reverseRequesters: Map<
    WebSocket,
    (
      operation: RelayControlOperation,
      payload: unknown,
      timeoutMs: number
    ) => Promise<unknown>
  >,
  peerAddress: string | undefined
): void {
  const unsignedChallenge = {
    expiresAt: Date.now() + AUTHENTICATION_WINDOW_MS,
    nonce: randomBytes(32).toString("base64url"),
    relayId: options.identity.fingerprint,
    sessionId: randomUUID(),
    type: "auth.challenge" as const,
    v: 1 as const,
  }
  const challenge: RelayAuthChallenge = {
    ...unsignedChallenge,
    signature: sign(
      null,
      Buffer.from(relayAuthChallengeTranscript(unsignedChallenge)),
      options.identity.privateKeyPem
    ).toString("base64url"),
  }
  send(socket, challenge)

  let authenticatedClient: RelayClientGrant | null = null
  let unsubscribeSnapshots: (() => void) | null = null
  let eventSequence = 0
  const inFlight = new Map<string, AbortController>()
  const reversePending = new Map<
    string,
    {
      reject: (cause: Error) => void
      resolve: (payload: unknown) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const authenticationTimeout = setTimeout(() => {
    if (!authenticatedClient) socket.close(4401, "Authentication timed out")
  }, AUTHENTICATION_WINDOW_MS)
  authenticationTimeout.unref()

  socket.on("pong", () => {
    ;(socket as TrackedWebSocket).kilnAlive = true
  })
  ;(socket as TrackedWebSocket).kilnAlive = true

  socket.on("message", (data, binary) => {
    if (binary) {
      socket.close(4400, "Binary control frames are not supported")
      return
    }
    let message: typeof RelayControlClientMessageSchema.Type
    try {
      message = Schema.decodeUnknownSync(RelayControlClientMessageSchema)(
        JSON.parse(data.toString()) as unknown
      )
    } catch {
      sendError(socket, null, "invalid_message", "Invalid control message")
      return
    }

    if (!authenticatedClient) {
      if (message.type !== "auth.response") {
        socket.close(4401, "Authentication required")
        return
      }
      void authenticateClient(message.clientId, message.signature).catch(() => {
        socket.close(4401, "Authentication failed")
      })
      return
    }

    if (message.type === "auth.response") {
      socket.close(4400, "Session is already authenticated")
      return
    }
    if (message.type === "cancel") {
      inFlight.get(message.replyTo)?.abort()
      return
    }
    if (message.type === "response" || message.type === "error") {
      const pending = message.replyTo
        ? reversePending.get(message.replyTo)
        : undefined
      if (!pending) return
      clearTimeout(pending.timer)
      reversePending.delete(message.replyTo as string)
      if (message.type === "response") pending.resolve(message.payload)
      else pending.reject(new Error(message.message))
      return
    }
    if (inFlight.size >= MAX_IN_FLIGHT_REQUESTS) {
      sendError(
        socket,
        message.id,
        "too_many_requests",
        "Too many requests are in flight",
        true
      )
      return
    }
    if (inFlight.has(message.id)) {
      sendError(
        socket,
        message.id,
        "duplicate_request",
        "A request with this ID is already in flight"
      )
      return
    }
    void executeRequest(message, authenticatedClient)
  })

  socket.once("close", () => {
    clearTimeout(authenticationTimeout)
    unsubscribeSnapshots?.()
    unsubscribeSnapshots = null
    for (const controller of inFlight.values()) controller.abort()
    inFlight.clear()
    for (const pending of reversePending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error("Hearth control connection closed"))
    }
    reversePending.clear()
  })

  async function authenticateClient(
    clientId: string,
    signature: string
  ): Promise<void> {
    if (Date.now() > challenge.expiresAt || authenticatedClient) {
      throw new Error("Expired or consumed authentication challenge")
    }
    const client = await options.runEffect(
      options.state.findClientById(clientId)
    )
    if (
      !client ||
      !isSourceAllowed(peerAddress, client.sourceCidrs) ||
      !authenticationVerifier({
        challenge: unsignedChallenge,
        client,
        signature,
      })
    ) {
      throw new Error("Invalid Hearth identity proof")
    }
    await completedAuthentication(client)
  }

  async function executeRequest(
    request: RelayControlRequest,
    sessionClient: RelayClientGrant
  ): Promise<void> {
    const now = Date.now()
    if (
      request.deadline <= now ||
      request.deadline > now + MAX_REQUEST_DEADLINE_MS
    ) {
      sendError(
        socket,
        request.id,
        "invalid_deadline",
        "Request deadline is invalid"
      )
      return
    }
    const currentClient = await options.runEffect(
      options.state.findClientById(sessionClient.id)
    )
    if (!currentClient) {
      socket.close(4403, "Hearth client was revoked")
      return
    }
    const action = actionForRequest(request)
    if (!action || !isActionAllowed(currentClient.actions, action)) {
      sendError(socket, request.id, "forbidden", "Relay permission denied")
      return
    }
    const controller = new AbortController()
    inFlight.set(request.id, controller)
    const timer = setTimeout(() => controller.abort(), request.deadline - now)
    timer.unref()
    try {
      const payload = await options.execute(
        request,
        currentClient,
        controller.signal
      )
      if (isAuditedMutation(request.operation)) {
        void options
          .runEffect(
            options.state.appendAudit({
              clientId: currentClient.id,
              details: { operation: request.operation },
              event: "control.mutation",
              id: randomUUID(),
              occurredAt: Date.now(),
              requestId: request.id,
            })
          )
          .catch((cause) =>
            Sentry.captureException(cause, {
              tags: { "kiln.operation": "relay.control.audit" },
            })
          )
      }
      const response: RelayControlResponse = {
        id: randomUUID(),
        payload,
        replyTo: request.id,
        type: "response",
        v: 1,
      }
      send(socket, response)
    } catch (cause) {
      sendError(
        socket,
        request.id,
        controller.signal.aborted ? "request_cancelled" : "operation_failed",
        controller.signal.aborted
          ? "Relay request was cancelled"
          : safeErrorMessage(cause)
      )
    } finally {
      clearTimeout(timer)
      inFlight.delete(request.id)
    }
  }

  async function completedAuthentication(
    client: RelayClientGrant
  ): Promise<void> {
    const clientSessionCount = [...authenticatedSockets.values()].filter(
      (authenticated) => authenticated.id === client.id
    ).length
    if (clientSessionCount >= MAX_CONTROL_SESSIONS_PER_CLIENT) {
      socket.close(4429, "Hearth client session capacity reached")
      return
    }
    authenticatedClient = client
    clearTimeout(authenticationTimeout)
    sessions.set(challenge.sessionId, client)
    socketSessions.set(socket, challenge.sessionId)
    authenticatedSockets.set(socket, client)
    reverseRequesters.set(socket, requestClient)
    await options.runEffect(
      options.state.touchClient(client.id, Date.now(), peerAddress ?? null)
    )
    const ready: RelayAuthReady = {
      actions: client.actions,
      clientId: client.id,
      protocol: relayControlProtocol,
      relayBuild: process.env.SOURCE_COMMIT?.trim() || "development",
      role: client.role,
      type: "auth.ready",
      v: 1,
    }
    send(socket, ready)
    const snapshot: RelayControlEvent = {
      event: "relay.snapshot",
      id: randomUUID(),
      payload: await options.initialSnapshot(),
      seq: ++eventSequence,
      type: "event",
      v: 1,
    }
    send(socket, snapshot)
    if (socket.readyState !== WebSocket.OPEN) return
    unsubscribeSnapshots = options.subscribeSnapshots((payload) => {
      const update: RelayControlEvent = {
        event: "relay.snapshot",
        id: randomUUID(),
        payload,
        seq: ++eventSequence,
        type: "event",
        v: 1,
      }
      send(socket, update)
    })
  }

  function requestClient(
    operation: RelayControlOperation,
    payload: unknown,
    timeoutMs: number
  ): Promise<unknown> {
    if (!authenticatedClient || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new Error("Hearth control connection is unavailable")
      )
    }
    const duration = Math.min(Math.max(timeoutMs, 1), MAX_REQUEST_DEADLINE_MS)
    const id = randomUUID()
    const request: RelayControlRequest = {
      deadline: Date.now() + duration,
      id,
      operation,
      payload,
      type: "request",
      v: 1,
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reversePending.delete(id)
        reject(new Error(`Hearth request timed out after ${duration}ms`))
      }, duration)
      timer.unref()
      reversePending.set(id, { reject, resolve, timer })
      send(socket, request)
    })
  }
}

function isAuditedMutation(operation: RelayControlOperation): boolean {
  return (
    operation === "relay.networking.write" ||
    operation === "instance.create" ||
    operation === "instance.delete" ||
    operation === "instance.action" ||
    operation === "instance.files.write" ||
    operation === "instance.console.write"
  )
}

function closeClientSockets(
  authenticatedSockets: ReadonlyMap<WebSocket, RelayClientGrant>,
  clientId: string,
  reason: string
): void {
  for (const [socket, client] of authenticatedSockets) {
    if (client.id === clientId) socket.close(4403, reason)
  }
}

export function authenticationVerifier(options: {
  readonly challenge: Omit<RelayAuthChallenge, "signature">
  readonly client: RelayClientGrant
  readonly signature: string
}): boolean {
  try {
    return verify(
      null,
      Buffer.from(
        relayAuthResponseTranscript(options.challenge, options.client.id)
      ),
      createPublicKey(options.client.publicKey),
      Buffer.from(options.signature, "base64url")
    )
  } catch {
    return false
  }
}

function actionForRequest(request: RelayControlRequest): RelayAction | null {
  switch (request.operation) {
    case "relay.snapshot":
      return "relay.read"
    case "relay.rename":
      return "relay.rename"
    case "relay.audit.list":
      return "relay.audit.read"
    case "relay.networking.read":
      return "instance.network.read"
    case "relay.networking.write":
      return "instance.network.write"
    case "relay.pairing.create":
      return "relay.pairing.create"
    case "relay.pairing.list":
      return "relay.pairing.list"
    case "relay.pairing.revoke":
      return "relay.pairing.revoke"
    case "relay.clients.list":
      return "relay.clients.list"
    case "relay.clients.update":
      return "relay.clients.update"
    case "relay.clients.revoke":
      return "relay.clients.revoke"
    case "brick.catalog":
    case "brick.recipe":
      return "brick.read"
    case "instance.create":
      return "instance.create"
    case "instance.delete":
      return "instance.delete"
    case "instance.action": {
      const action = objectString(request.payload, "action")
      if (action === "start") return "instance.power.start"
      if (action === "stop") return "instance.power.stop"
      if (action === "restart") return "instance.power.restart"
      if (action === "kill") return "instance.power.kill"
      return null
    }
    case "instance.files.list":
      return "instance.files.list"
    case "instance.files.read":
      return "instance.files.read"
    case "instance.files.write":
      return "instance.files.write"
    case "instance.console.history":
      return "instance.console.read"
    case "instance.console.write":
      return "instance.console.write"
    case "instance.console.complete":
      return "instance.console.read"
    case "instance.logs.latest":
      return "instance.logs.read"
    case "sftp.authorization.resolve":
      return "instance.sftp.connect"
  }
  return null
}

function objectString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || !(key in value)) return null
  const field = (value as Record<string, unknown>)[key]
  return typeof field === "string" ? field : null
}

function parseProtocols(value: string | undefined): ReadonlyArray<string> {
  return value?.split(",").map((protocol) => protocol.trim()) ?? []
}

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
    socket.close(1013, "Control socket is not consuming messages")
    return
  }
  socket.send(JSON.stringify(message))
}

function sendError(
  socket: WebSocket,
  replyTo: string | null,
  code: string,
  message: string,
  retryable = false
): void {
  const error: RelayControlError = {
    code,
    id: randomUUID(),
    message,
    replyTo,
    retryable,
    type: "error",
    v: 1,
  }
  send(socket, error)
}

function safeErrorMessage(cause: unknown): string {
  if (!cause || typeof cause !== "object" || !("message" in cause)) {
    return "Relay operation failed"
  }
  const message = (cause as { message?: unknown }).message
  return typeof message === "string" && message.length <= 240
    ? message
    : "Relay operation failed"
}
