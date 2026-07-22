import {
  relayBrowserProofTranscript,
  relayBrowserProtocol,
  relayResourceStreamEventSchema,
} from "@workspace/contracts"
import type { RelayResourceStreamEvent } from "@workspace/contracts"

import { issueResourceCapability } from "@/server/relay-capability"

export async function* openRelayResourceStream(
  relayId: string,
  instanceId: string,
  signal: AbortSignal
): AsyncGenerator<RelayResourceStreamEvent> {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  )
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keys.publicKey)
  const capability = await issueResourceCapability({
    data: {
      instanceId,
      publicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: requiredCoordinate(publicKeyJwk.x),
        y: requiredCoordinate(publicKeyJwk.y),
      },
      relayId,
    },
  })
  const relayOrigin = new URL(capability.browserOrigin)
  relayOrigin.protocol = relayOrigin.protocol === "https:" ? "wss:" : "ws:"
  relayOrigin.pathname = "/v1/browser"
  const socket = new WebSocket(relayOrigin, relayBrowserProtocol)
  const inbox = createSocketInbox(socket, signal)

  try {
    const challenge = await inbox.next()
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
      throw new Error("Relay browser authentication failed")
    }
    socket.send(
      JSON.stringify({ instanceId, type: "resource.subscribe", v: 1 })
    )

    for (;;) {
      // Resource samples are ordered; concurrent reads could reorder them.
      // oxlint-disable-next-line react-doctor/async-await-in-loop
      yield relayResourceStreamEventSchema.parse(await inbox.next())
    }
  } finally {
    inbox.close()
    socket.close(1000, "Resource view closed")
  }
}

function createSocketInbox(socket: WebSocket, signal: AbortSignal) {
  const messages: Array<Record<string, unknown>> = []
  const waiters: Array<{
    reject: (cause: Error) => void
    resolve: (value: Record<string, unknown>) => void
  }> = []
  const fail = (cause: Error) => {
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
      fail(cause instanceof Error ? cause : new Error("Invalid Relay message"))
    }
  })
  socket.addEventListener("error", () =>
    fail(new Error("Unable to connect to Relay"))
  )
  socket.addEventListener("close", (event) =>
    fail(new Error(event.reason || `Relay connection closed (${event.code})`))
  )
  const abort = () => {
    fail(new Error("Resource stream was cancelled"))
    socket.close(1000, "Resource stream cancelled")
  }
  signal.addEventListener("abort", abort, { once: true })
  return {
    close: () => signal.removeEventListener("abort", abort),
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
  if (!value) throw new Error("Browser could not create a resource session key")
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
