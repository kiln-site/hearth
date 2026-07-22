import {
  relayBrowserProofTranscript,
  relayBrowserProtocol,
  relayConsoleStreamEventSchema,
} from "@workspace/contracts"
import type { RelayConsoleStreamEvent } from "@workspace/contracts"

import { issueConsoleCapability } from "@/server/relay-capability"

const AUTHENTICATION_TIMEOUT_MS = 10_000

export type RelayConsoleTransport = "direct" | "hearth"

export type KilnConsoleStreamEvent =
  | RelayConsoleStreamEvent
  | {
      message: string | null
      transport: RelayConsoleTransport
      type: "transport"
    }

export class RelayConsoleConnectionError extends Error {
  readonly code:
    | "browser_offline"
    | "console_unavailable"
    | "direct_secure_channel_failed"
    | "hearth_proxy_failed"

  constructor(
    code: RelayConsoleConnectionError["code"],
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = "RelayConsoleConnectionError"
    this.code = code
  }
}

export async function* openRelayConsoleStream(
  relayId: string,
  instanceId: string,
  signal: AbortSignal
): AsyncGenerator<KilnConsoleStreamEvent> {
  if (!navigator.onLine) {
    throw new RelayConsoleConnectionError(
      "browser_offline",
      "You're offline. Reconnect to the internet to resume the console."
    )
  }

  let directFailure: Error | null = null
  try {
    const direct = openDirectRelayConsoleStream(relayId, instanceId, signal)
    const first = await direct.next()
    if (first.done) throw new Error("Direct Relay console stream ended early")
    yield { message: null, transport: "direct", type: "transport" }
    yield first.value
    for (;;) {
      // Console frames are a single ordered stream.
      // oxlint-disable-next-line react-doctor/async-await-in-loop
      const result = await direct.next()
      if (result.done) throw new Error("Direct Relay console stream closed")
      yield result.value
    }
  } catch (cause) {
    if (signal.aborted) throw asError(cause)
    directFailure = asError(cause)
  }

  try {
    const proxied = openHearthConsoleStream(relayId, instanceId, signal)
    const first = await proxied.next()
    if (first.done) throw new Error("Hearth console proxy ended early")
    yield {
      message: directFallbackMessage(directFailure),
      transport: "hearth",
      type: "transport",
    }
    yield first.value
    for (;;) {
      // Hearth preserves the Relay stream ordering.
      // oxlint-disable-next-line react-doctor/async-await-in-loop
      const result = await proxied.next()
      if (result.done) throw new Error("Hearth console proxy closed")
      yield result.value
    }
  } catch (cause) {
    if (signal.aborted) throw asError(cause)
    throw new RelayConsoleConnectionError(
      "hearth_proxy_failed",
      directFailure
        ? "Hearth can reach this Relay, but neither the secure direct stream nor the Hearth fallback could read the console."
        : "Hearth could not open the Relay console stream.",
      { cause }
    )
  }
}

async function* openDirectRelayConsoleStream(
  relayId: string,
  instanceId: string,
  signal: AbortSignal
): AsyncGenerator<RelayConsoleStreamEvent> {
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
        x: requiredJwkCoordinate(publicKeyJwk.x),
        y: requiredJwkCoordinate(publicKeyJwk.y),
      },
      relayId,
    },
  })
  if (capability.proxyMode === "hearth") {
    throw new RelayConsoleConnectionError(
      "direct_secure_channel_failed",
      "This Relay is configured to stream through Hearth."
    )
  }
  const relayOrigin = new URL(capability.browserOrigin)
  relayOrigin.protocol = relayOrigin.protocol === "https:" ? "wss:" : "ws:"
  relayOrigin.pathname = "/v1/browser"
  const socket = new WebSocket(relayOrigin, relayBrowserProtocol)
  const inbox = createSocketInbox(socket, signal)

  try {
    const challenge = await nextAuthenticationMessage(inbox, "challenge")
    if (
      challenge.type !== "auth.challenge" ||
      challenge.relayId !== relayId ||
      typeof challenge.sessionId !== "string" ||
      typeof challenge.nonce !== "string" ||
      typeof challenge.expiresAt !== "number" ||
      challenge.expiresAt <= Date.now()
    ) {
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
          x: requiredJwkCoordinate(publicKeyJwk.x),
          y: requiredJwkCoordinate(publicKeyJwk.y),
        },
        signature: bytesToBase64Url(new Uint8Array(proof)),
        type: "auth",
        v: 1,
      })
    )
    const ready = await nextAuthenticationMessage(inbox, "confirmation")
    if (ready.type !== "auth.ready" || ready.instanceId !== instanceId) {
      throw new Error("Relay browser authentication failed")
    }
    socket.send(JSON.stringify({ instanceId, type: "console.subscribe", v: 1 }))

    // Console frames are a single ordered stream; concurrent reads could reorder them.
    for (;;) {
      // This is an ordered, unbounded socket stream; parallel reads would reorder frames.
      // oxlint-disable-next-line react-doctor/async-await-in-loop
      const message = await inbox.next()
      yield relayConsoleStreamEventSchema.parse(message)
    }
  } finally {
    inbox.close()
    socket.close(1000, "Console view closed")
  }
}

async function nextAuthenticationMessage(
  inbox: { next: () => Promise<Record<string, unknown>> },
  stage: string
): Promise<Record<string, unknown>> {
  let timer: number | undefined
  try {
    return await Promise.race([
      inbox.next(),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error(`Relay authentication ${stage} timed out`)),
          AUTHENTICATION_TIMEOUT_MS
        )
      }),
    ])
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

async function* openHearthConsoleStream(
  relayId: string,
  instanceId: string,
  signal: AbortSignal
): AsyncGenerator<RelayConsoleStreamEvent> {
  const response = await fetch(
    `/api/console/${encodeURIComponent(instanceId)}?relayId=${encodeURIComponent(relayId)}`,
    { cache: "no-store", signal }
  )
  if (!response.ok || !response.body) {
    const problem = (await response.json().catch(() => null)) as {
      error?: unknown
    } | null
    throw new Error(
      typeof problem?.error === "string"
        ? problem.error
        : `Hearth console proxy returned HTTP ${response.status}`
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ""
  try {
    for (;;) {
      // NDJSON chunks can split records at arbitrary byte boundaries.
      // oxlint-disable-next-line react-doctor/async-await-in-loop
      const result = await reader.read()
      buffered += decoder.decode(result.value, { stream: !result.done })
      const lines = buffered.split("\n")
      buffered = lines.pop() ?? ""
      for (const line of lines) {
        if (!line) continue
        const value = JSON.parse(line) as unknown
        if (
          value &&
          typeof value === "object" &&
          "type" in value &&
          value.type === "proxy.error"
        ) {
          const message =
            "message" in value && typeof value.message === "string"
              ? value.message
              : "Hearth console proxy was interrupted"
          throw new Error(message)
        }
        yield relayConsoleStreamEventSchema.parse(value)
      }
      if (result.done) break
    }
    if (buffered.trim()) {
      yield relayConsoleStreamEventSchema.parse(JSON.parse(buffered))
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function directFallbackMessage(cause: Error): string {
  return cause instanceof RelayConsoleConnectionError &&
    cause.code === "direct_secure_channel_failed"
    ? "Secure direct connection unavailable. Streaming through Hearth."
    : "Direct Relay stream interrupted. Streaming through Hearth."
}

export function createSocketInbox(socket: WebSocket, signal: AbortSignal) {
  const messages: Array<Record<string, unknown>> = []
  let terminalError: Error | null = null
  const waiters: Array<{
    reject: (cause: Error) => void
    resolve: (value: Record<string, unknown>) => void
  }> = []
  const fail = (cause: Error) => {
    terminalError ??= cause
    for (const waiter of waiters.splice(0)) waiter.reject(cause)
  }
  socket.addEventListener("message", (event) => {
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
      fail(asError(cause))
    }
  })
  socket.addEventListener("error", () =>
    fail(new Error("Unable to connect to Relay"))
  )
  socket.addEventListener("close", (event) =>
    fail(
      new Error(
        event.reason || `Relay browser connection closed (${event.code})`
      )
    )
  )
  const abort = () => {
    fail(new Error("Console stream was cancelled"))
    socket.close(1000, "Console stream cancelled")
  }
  signal.addEventListener("abort", abort, { once: true })
  return {
    close: () => signal.removeEventListener("abort", abort),
    next: () => {
      const message = messages.shift()
      if (message) return Promise.resolve(message)
      if (terminalError) return Promise.reject(terminalError)
      return new Promise<Record<string, unknown>>((resolve, reject) =>
        waiters.push({ reject, resolve })
      )
    },
  }
}

function capabilityId(capability: string): string {
  const encoded = capability.split(".", 1)[0]
  if (!encoded) throw new Error("Hearth returned an invalid Relay capability")
  const value = JSON.parse(atobBase64Url(encoded)) as unknown
  if (!value || typeof value !== "object" || !("capabilityId" in value)) {
    throw new Error("Hearth returned an invalid Relay capability")
  }
  const id = Object.fromEntries(Object.entries(value)).capabilityId
  if (typeof id !== "string") {
    throw new Error("Hearth returned an invalid Relay capability")
  }
  return id
}

function requiredJwkCoordinate(value: string | undefined): string {
  if (!value) throw new Error("Browser could not create a console session key")
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

function atobBase64Url(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/")
  return atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))
}

function asError(cause: unknown): Error {
  return cause instanceof Error
    ? cause
    : new Error("Relay browser connection failed")
}
