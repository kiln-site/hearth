import { randomUUID, sign, verify } from "node:crypto"
import * as Sentry from "@sentry/tanstackstart-react"
import { Schema } from "effect"
import { WebSocket } from "ws"

import {
  RelayControlServerMessageSchema,
  relayAuthChallengeTranscript,
  relayAuthResponseTranscript,
  relayControlDeadlineMs,
  relayControlProtocol,
} from "@workspace/contracts"
import type {
  RelayAuthChallenge,
  RelayControlOperation,
  RelayControlRequest,
} from "@workspace/contracts"

import type { RelayCredentials } from "@/lib/relay-registry"
import { resolveSftpAuthorization } from "@/lib/sftp-authorization"

interface RelayEndpoint {
  hostname: string
  id: string
  port: number
  useTls: boolean
}

const MAX_BACKOFF_MS = 30_000

export type RelayConnectionStatus =
  | "authenticated"
  | "connecting"
  | "disconnected"
  | "unreachable"

export interface RelayConnectionState {
  lastError: string | null
  status: RelayConnectionStatus
  updatedAt: number
}

declare global {
  var kilnRelayConnections: Map<string, RelayConnection> | undefined
}

const connections = (globalThis.kilnRelayConnections ??= new Map())

export async function relayRpc(
  relay: RelayEndpoint,
  operation: RelayControlOperation,
  payload: unknown,
  timeoutMs = 10_000
): Promise<unknown> {
  let connection = connections.get(relay.id)
  if (connection && !connection.matches(relay)) {
    connection.close()
    connections.delete(relay.id)
    connection = undefined
  }
  if (!connection) {
    connection = new RelayConnection(relay)
    connections.set(relay.id, connection)
  }
  return connection.request(operation, payload, timeoutMs)
}

export function relayConnectionState(relayId: string): RelayConnectionState {
  return (
    connections.get(relayId)?.state ?? {
      lastError: null,
      status: "disconnected",
      updatedAt: Date.now(),
    }
  )
}

export function closeRelayConnection(relayId: string): void {
  connections.get(relayId)?.close()
  connections.delete(relayId)
}

class RelayConnection {
  #attempt = 0
  #closed = false
  #connecting: Promise<void> | null = null
  #credentials: RelayCredentials | null = null
  #pending = new Map<
    string,
    {
      reject: (cause: Error) => void
      resolve: (value: unknown) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  #hasPushedSnapshot = false
  #pushedSnapshot: unknown = null
  #eventSequence = 0
  #relay: RelayEndpoint
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null
  #socket: WebSocket | null = null
  #state: RelayConnectionState = {
    lastError: null,
    status: "disconnected",
    updatedAt: Date.now(),
  }

  constructor(relay: RelayEndpoint) {
    this.#relay = relay
  }

  get state(): RelayConnectionState {
    return this.#state
  }

  matches(relay: RelayEndpoint): boolean {
    return (
      this.#relay.hostname === relay.hostname &&
      this.#relay.port === relay.port &&
      this.#relay.useTls === relay.useTls
    )
  }

  async request(
    operation: RelayControlOperation,
    payload: unknown,
    timeoutMs: number
  ): Promise<unknown> {
    await this.#connect()
    if (operation === "relay.snapshot" && this.#hasPushedSnapshot) {
      const snapshot = this.#pushedSnapshot
      this.#hasPushedSnapshot = false
      return snapshot
    }
    const socket = this.#socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Relay control socket is not connected")
    }
    const id = randomUUID()
    const request: RelayControlRequest = {
      deadline:
        Date.now() + Math.min(timeoutMs, relayControlDeadlineMs(operation)),
      id,
      operation,
      payload,
      type: "request",
      v: 1,
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        socket.send(
          JSON.stringify({
            id: randomUUID(),
            replyTo: id,
            type: "cancel",
            v: 1,
          })
        )
        reject(new Error(`Relay request timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.#pending.set(id, { reject, resolve, timer })
      socket.send(JSON.stringify(request), (cause) => {
        if (!cause) return
        clearTimeout(timer)
        this.#pending.delete(id)
        reject(cause)
      })
    })
  }

  close(): void {
    this.#closed = true
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = null
    this.#socket?.close(1000, "Hearth connection closed")
    this.#socket = null
    this.#rejectPending(new Error("Relay connection closed"))
    this.#setState("disconnected", null)
  }

  #connect(): Promise<void> {
    if (
      this.#socket?.readyState === WebSocket.OPEN &&
      this.#state.status === "authenticated"
    ) {
      return Promise.resolve()
    }
    this.#connecting ??= this.#open().finally(() => {
      this.#connecting = null
    })
    return this.#connecting
  }

  async #open(): Promise<void> {
    this.#setState("connecting", null)
    this.#eventSequence = 0
    this.#hasPushedSnapshot = false
    this.#socket = null
    let socket: WebSocket | null = null
    try {
      const { loadRelayCredentials } = await import("@/lib/relay-registry")
      const credentials = await loadRelayCredentials(this.#relay.id)
      if (this.#closed) return
      this.#credentials = credentials
      const protocol = this.#relay.useTls ? "wss" : "ws"
      const activeSocket = new WebSocket(
        `${protocol}://${formatHost(this.#relay.hostname)}:${this.#relay.port}/v1/socket`,
        relayControlProtocol,
        {
          ca: this.#credentials.caCertificatePem ?? undefined,
          handshakeTimeout: 5_000,
          maxPayload: 1024 * 1024,
          perMessageDeflate: false,
          rejectUnauthorized: this.#relay.useTls,
        }
      )
      socket = activeSocket
      this.#socket = activeSocket
      await new Promise<void>((resolve, reject) => {
        let authenticated = false
        let challengeAnswered = false
        const authenticationTimer = setTimeout(
          () => reject(new Error("Relay authentication timed out")),
          10_000
        )
        activeSocket.on("message", (data, binary) => {
          if (binary) {
            reject(new Error("Relay sent an unsupported binary control frame"))
            return
          }
          let message: typeof RelayControlServerMessageSchema.Type
          try {
            message = Schema.decodeUnknownSync(RelayControlServerMessageSchema)(
              JSON.parse(data.toString()) as unknown
            )
          } catch {
            reject(new Error("Relay sent an invalid control message"))
            return
          }
          if (message.type === "auth.challenge") {
            if (challengeAnswered) {
              reject(new Error("Relay repeated its authentication challenge"))
              return
            }
            try {
              this.#answerChallenge(activeSocket, message)
              challengeAnswered = true
            } catch (cause) {
              reject(asError(cause))
            }
            return
          }
          if (message.type === "auth.ready") {
            if (
              !challengeAnswered ||
              message.clientId !== this.#credentials?.clientId
            ) {
              reject(new Error("Relay authenticated the wrong Hearth identity"))
              return
            }
            this.#attempt = 0
            this.#setState("authenticated", null)
            authenticated = true
            if (this.#hasPushedSnapshot) {
              clearTimeout(authenticationTimer)
              resolve()
            }
            return
          }
          if (!authenticated) {
            reject(
              new Error("Relay sent a control message before authentication")
            )
            activeSocket.close(4401, "Relay authentication is incomplete")
            return
          }
          if (message.type === "event") {
            if (message.seq <= this.#eventSequence) {
              reject(new Error("Relay event sequence moved backwards"))
              return
            }
            this.#eventSequence = message.seq
            if (message.event === "relay.snapshot") {
              this.#pushedSnapshot = message.payload
              this.#hasPushedSnapshot = true
              if (authenticated) {
                clearTimeout(authenticationTimer)
                resolve()
              }
            }
            return
          }
          void this.#handleMessage(message)
        })
        activeSocket.once("error", reject)
        activeSocket.once("close", (code, reason) => {
          clearTimeout(authenticationTimer)
          const error = new Error(
            `Relay connection closed (${code}${reason.length ? `: ${reason.toString()}` : ""})`
          )
          this.#socket = null
          this.#rejectPending(error)
          this.#setState("unreachable", error.message)
          this.#attempt += 1
          this.#scheduleReconnect()
          reject(error)
        })
      })
    } catch (cause) {
      socket?.terminate()
      const error = asError(cause)
      if (!socket) this.#attempt += 1
      this.#setState("unreachable", error.message)
      this.#scheduleReconnect()
      throw error
    }
  }

  #answerChallenge(socket: WebSocket, challenge: RelayAuthChallenge): void {
    const credentials = this.#credentials
    if (!credentials) throw new Error("Relay credentials are unavailable")
    if (
      challenge.relayId !== this.#relay.id ||
      challenge.expiresAt <= Date.now() ||
      !verify(
        null,
        Buffer.from(relayAuthChallengeTranscript(challenge)),
        credentials.relayPublicKeyPem,
        Buffer.from(challenge.signature, "base64url")
      )
    ) {
      throw new Error("Relay identity challenge could not be verified")
    }
    socket.send(
      JSON.stringify({
        clientId: credentials.clientId,
        signature: sign(
          null,
          Buffer.from(
            relayAuthResponseTranscript(challenge, credentials.clientId)
          ),
          credentials.clientPrivateKeyPem
        ).toString("base64url"),
        type: "auth.response",
        v: 1,
      })
    )
  }

  async #handleMessage(
    message: typeof RelayControlServerMessageSchema.Type
  ): Promise<void> {
    if (message.type === "response") {
      const pending = this.#pending.get(message.replyTo)
      if (!pending) return
      clearTimeout(pending.timer)
      this.#pending.delete(message.replyTo)
      pending.resolve(message.payload)
      return
    }
    if (message.type === "error" && message.replyTo) {
      const pending = this.#pending.get(message.replyTo)
      if (!pending) return
      clearTimeout(pending.timer)
      this.#pending.delete(message.replyTo)
      pending.reject(new Error(message.message))
      return
    }
    if (message.type === "request") {
      await this.#handleRelayRequest(message)
    }
  }

  async #handleRelayRequest(request: RelayControlRequest): Promise<void> {
    const socket = this.#socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    try {
      if (request.deadline <= Date.now()) {
        throw new Error("Relay request deadline expired")
      }
      if (request.operation !== "sftp.authorization.resolve") {
        throw new Error("Relay operation is not available from Hearth")
      }
      const payload = objectRecord(request.payload)
      const username = payload.username
      if (typeof username !== "string") {
        throw new Error("SFTP username is required")
      }
      const authorization = await resolveSftpAuthorization(
        this.#relay.id,
        username
      )
      socket.send(
        JSON.stringify({
          id: randomUUID(),
          payload: authorization,
          replyTo: request.id,
          type: "response",
          v: 1,
        })
      )
    } catch (cause) {
      const error = asError(cause)
      Sentry.captureException(error, {
        tags: {
          "kiln.operation": request.operation,
          "kiln.relay_id": this.#relay.id,
        },
      })
      socket.send(
        JSON.stringify({
          code: "hearth_operation_failed",
          id: randomUUID(),
          message: error.message,
          replyTo: request.id,
          retryable: false,
          type: "error",
          v: 1,
        })
      )
    }
  }

  #rejectPending(cause: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(cause)
    }
    this.#pending.clear()
  }

  #setState(status: RelayConnectionStatus, lastError: string | null): void {
    this.#state = { lastError, status, updatedAt: Date.now() }
    Sentry.addBreadcrumb({
      category: "relay.connection",
      data: { relayId: this.#relay.id },
      level: status === "unreachable" ? "warning" : "info",
      message: status,
    })
  }

  #scheduleReconnect(): void {
    if (this.#closed || this.#reconnectTimer) return
    const maximum = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.#attempt)
    const delay = Math.floor(Math.random() * Math.max(maximum, 500))
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null
      void this.#connect().catch(() => undefined)
    }, delay)
    this.#reconnectTimer.unref()
  }
}

function formatHost(hostname: string): string {
  return hostname.includes(":") && !hostname.startsWith("[")
    ? `[${hostname}]`
    : hostname
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error("Relay connection failed")
}

function objectRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {}
}
