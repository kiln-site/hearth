import {
  relayBrowserProofTranscript,
  relayBrowserProtocol,
  relayConsoleCommandResultSchema,
  relayConsoleCompletionSchema,
} from "@workspace/contracts"
import type {
  RelayConsoleCompletion,
  RelayConsoleCommandResult,
} from "@workspace/contracts"

import { issueConsoleCapability } from "@/server/relay-capability"

const sessions = new Map<string, Promise<ConsoleCommandSession>>()

export async function sendDirectRelayCommand(
  relayId: string,
  instanceId: string,
  command: string
): Promise<RelayConsoleCommandResult> {
  const session = await commandSession(relayId, instanceId)
  return relayConsoleCommandResultSchema.parse(
    await session.request("console.write", { command })
  )
}

export async function completeDirectRelayCommand(
  relayId: string,
  instanceId: string,
  input: string,
  cursor: number
): Promise<RelayConsoleCompletion> {
  const session = await commandSession(relayId, instanceId)
  return relayConsoleCompletionSchema.parse(
    await session.request("console.complete", { cursor, input })
  )
}

async function commandSession(
  relayId: string,
  instanceId: string
): Promise<ConsoleCommandSession> {
  const key = `${relayId}:${instanceId}`
  const existing = sessions.get(key)
  if (existing) return existing
  const created = ConsoleCommandSession.connect(relayId, instanceId, () => {
    if (sessions.get(key) === created) sessions.delete(key)
  }).catch((cause) => {
    if (sessions.get(key) === created) sessions.delete(key)
    throw cause
  })
  sessions.set(key, created)
  return created
}

class ConsoleCommandSession {
  readonly #inbox: ReturnType<typeof createSocketInbox>
  readonly #instanceId: string
  readonly #onClose: () => void
  readonly #pending = new Map<
    string,
    {
      reject: (cause: Error) => void
      resolve: (value: unknown) => void
      timer: number
    }
  >()
  readonly #socket: WebSocket
  #closed = false

  private constructor(
    socket: WebSocket,
    inbox: ReturnType<typeof createSocketInbox>,
    instanceId: string,
    onClose: () => void
  ) {
    this.#socket = socket
    this.#inbox = inbox
    this.#instanceId = instanceId
    this.#onClose = onClose
    void this.#read()
  }

  static async connect(
    relayId: string,
    instanceId: string,
    onClose: () => void
  ): Promise<ConsoleCommandSession> {
    const keys = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"]
    )
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keys.publicKey)
    const capability = await issueConsoleCapability({
      data: {
        instanceId,
        publicKeyJwk: {
          crv: "P-256",
          kty: "EC",
          x: requiredCoordinate(publicKeyJwk.x),
          y: requiredCoordinate(publicKeyJwk.y),
        },
        relayId,
        write: true,
      },
    })
    const relayOrigin = new URL(capability.browserOrigin)
    relayOrigin.protocol = relayOrigin.protocol === "https:" ? "wss:" : "ws:"
    relayOrigin.pathname = "/v1/browser"
    const socket = new WebSocket(relayOrigin, relayBrowserProtocol)
    const inbox = createSocketInbox(socket)
    const challenge = await inbox.next()
    if (
      challenge.type !== "auth.challenge" ||
      challenge.relayId !== relayId ||
      typeof challenge.sessionId !== "string" ||
      typeof challenge.nonce !== "string" ||
      typeof challenge.expiresAt !== "number" ||
      challenge.expiresAt <= Date.now()
    ) {
      socket.close(4400, "Invalid Relay challenge")
      throw new Error("Relay returned an invalid browser challenge")
    }
    const proof = await crypto.subtle.sign(
      { hash: "SHA-256", name: "ECDSA" },
      keys.privateKey,
      new TextEncoder().encode(
        relayBrowserProofTranscript({
          capabilityId: capabilityId(capability.capability),
          expiresAt: challenge.expiresAt,
          nonce: challenge.nonce,
          relayId,
          sessionId: challenge.sessionId,
        })
      )
    )
    socket.send(
      JSON.stringify({
        capability: capability.capability,
        publicKeyJwk: {
          crv: "P-256",
          kty: "EC",
          x: requiredCoordinate(publicKeyJwk.x),
          y: requiredCoordinate(publicKeyJwk.y),
        },
        signature: bytesToBase64Url(new Uint8Array(proof)),
        type: "auth",
        v: 1,
      })
    )
    const ready = await inbox.next()
    if (ready.type !== "auth.ready" || ready.instanceId !== instanceId) {
      socket.close(4401, "Relay authentication failed")
      throw new Error("Relay browser authentication failed")
    }
    const session = new ConsoleCommandSession(
      socket,
      inbox,
      instanceId,
      onClose
    )
    const lifetime = Math.max(1, capability.expiresAt - Date.now() - 2_000)
    window.setTimeout(() => session.close(), lifetime)
    return session
  }

  request(
    operation: "console.complete" | "console.write",
    payload: Record<string, unknown>
  ): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error("Relay session closed"))
    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.#pending.delete(requestId)
        reject(new Error("Relay command timed out"))
      }, 8_000)
      this.#pending.set(requestId, { reject, resolve, timer })
      this.#socket.send(
        JSON.stringify({
          ...payload,
          instanceId: this.#instanceId,
          requestId,
          type: operation,
          v: 1,
        })
      )
    })
  }

  close(cause = new Error("Relay command session closed")): void {
    if (this.#closed) return
    this.#closed = true
    this.#inbox.close()
    this.#socket.close(1000, "Command session closed")
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(cause)
    }
    this.#pending.clear()
    this.#onClose()
  }

  async #read(): Promise<void> {
    try {
      for (;;) {
        // Operation responses are one ordered stream.
        // oxlint-disable-next-line react-doctor/async-await-in-loop
        const message = await this.#inbox.next()
        const requestId = message.requestId
        if (typeof requestId !== "string") continue
        const pending = this.#pending.get(requestId)
        if (!pending) continue
        clearTimeout(pending.timer)
        this.#pending.delete(requestId)
        if (message.type === "operation.result") pending.resolve(message.payload)
        else if (message.type === "operation.error") {
          pending.reject(
            new Error(
              typeof message.message === "string"
                ? message.message
                : "Relay operation failed"
            )
          )
        }
      }
    } catch (cause) {
      this.close(
        cause instanceof Error ? cause : new Error("Relay connection failed")
      )
    }
  }
}

function createSocketInbox(socket: WebSocket) {
  const messages: Array<Record<string, unknown>> = []
  const waiters: Array<{
    reject: (cause: Error) => void
    resolve: (value: Record<string, unknown>) => void
  }> = []
  const fail = (cause: Error) => {
    for (const waiter of waiters.splice(0)) waiter.reject(cause)
  }
  const receive = (event: MessageEvent) => {
    try {
      const value = JSON.parse(String(event.data)) as unknown
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Relay returned an invalid browser message")
      }
      const message = Object.fromEntries(Object.entries(value))
      const waiter = waiters.shift()
      if (waiter) waiter.resolve(message)
      else messages.push(message)
    } catch (cause) {
      fail(cause instanceof Error ? cause : new Error("Invalid Relay message"))
    }
  }
  const failed = () => fail(new Error("Unable to connect to Relay"))
  const closed = (event: CloseEvent) =>
    fail(new Error(event.reason || `Relay connection closed (${event.code})`))
  socket.addEventListener("message", receive)
  socket.addEventListener("error", failed)
  socket.addEventListener("close", closed)
  return {
    close: () => {
      fail(new Error("Relay command inbox closed"))
      socket.removeEventListener("message", receive)
      socket.removeEventListener("error", failed)
      socket.removeEventListener("close", closed)
    },
    next: () => {
      const message = messages.shift()
      if (message) return Promise.resolve(message)
      return new Promise<Record<string, unknown>>((resolve, reject) =>
        waiters.push({ reject, resolve })
      )
    },
  }
}

function capabilityId(capability: string): string {
  const encoded = capability.split(".", 1)[0]
  if (!encoded) throw new Error("Hearth returned an invalid Relay capability")
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/")
  const value = JSON.parse(
    atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))
  ) as unknown
  if (!value || typeof value !== "object" || !("capabilityId" in value)) {
    throw new Error("Hearth returned an invalid Relay capability")
  }
  const id = Object.fromEntries(Object.entries(value)).capabilityId
  if (typeof id !== "string") {
    throw new Error("Hearth returned an invalid Relay capability")
  }
  return id
}

function requiredCoordinate(value: string | undefined): string {
  if (!value) throw new Error("Browser could not create a command session key")
  return value
}

function bytesToBase64Url(value: Uint8Array): string {
  let binary = ""
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "")
}
