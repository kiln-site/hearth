import { generateKeyPairSync, sign } from "node:crypto"
import { WebSocket } from "ws"

import {
  relayBrowserProofTranscript,
  relayBrowserProtocol,
  relayConsoleStreamEventSchema,
} from "@workspace/contracts"
import type { RelayConsoleStreamEvent } from "@workspace/contracts"

import type { AuthenticatedUser } from "@/lib/auth-session"
import { kilnPublicUrl } from "@/lib/environment"
import { listPersistedRelays, loadRelayCredentials } from "@/lib/relay-registry"
import { issueConsoleCapabilityForUser } from "@/server/relay-capability-service"

export async function* openHearthRelayConsoleStream(input: {
  instanceId: string
  relayId: string
  signal: AbortSignal
  user: AuthenticatedUser
}): AsyncGenerator<RelayConsoleStreamEvent> {
  const relay = (await listPersistedRelays()).find(
    (candidate) => candidate.enabled && candidate.id === input.relayId
  )
  if (!relay) throw new Error("Relay is not configured or is paused")

  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  const publicKeyJwk = keys.publicKey.export({ format: "jwk" })
  const browserKey = {
    crv: "P-256" as const,
    kty: "EC" as const,
    x: requiredCoordinate(publicKeyJwk.x),
    y: requiredCoordinate(publicKeyJwk.y),
  }
  const [capability, credentials] = await Promise.all([
    issueConsoleCapabilityForUser({
      instanceId: input.instanceId,
      publicKeyJwk: browserKey,
      relayId: input.relayId,
      user: input.user,
      write: false,
    }),
    loadRelayCredentials(input.relayId),
  ])
  const protocol = relay.useTls ? "wss" : "ws"
  const socket = new WebSocket(
    `${protocol}://${formatHost(relay.hostname)}:${relay.port}/v1/browser`,
    relayBrowserProtocol,
    {
      ca: credentials.caCertificatePem ?? undefined,
      handshakeTimeout: 5_000,
      maxPayload: 256 * 1024,
      origin: kilnPublicUrl().origin,
      perMessageDeflate: false,
      rejectUnauthorized: relay.useTls,
    }
  )
  const inbox = createSocketInbox(socket, input.signal)

  try {
    const challenge = await inbox.next()
    if (
      challenge.type !== "auth.challenge" ||
      challenge.relayId !== input.relayId ||
      typeof challenge.sessionId !== "string" ||
      typeof challenge.nonce !== "string" ||
      typeof challenge.expiresAt !== "number" ||
      challenge.expiresAt <= Date.now()
    ) {
      throw new Error("Relay returned an invalid console challenge")
    }
    const proof = sign(
      "sha256",
      Buffer.from(
        relayBrowserProofTranscript({
          capabilityId: capabilityId(capability.capability),
          expiresAt: challenge.expiresAt,
          nonce: challenge.nonce,
          relayId: input.relayId,
          sessionId: challenge.sessionId,
        })
      ),
      { dsaEncoding: "ieee-p1363", key: keys.privateKey }
    )
    socket.send(
      JSON.stringify({
        capability: capability.capability,
        publicKeyJwk: browserKey,
        signature: proof.toString("base64url"),
        type: "auth",
        v: 1,
      })
    )
    const ready = await inbox.next()
    if (ready.type !== "auth.ready" || ready.instanceId !== input.instanceId) {
      throw new Error("Relay rejected the Hearth console proxy")
    }
    socket.send(
      JSON.stringify({
        instanceId: input.instanceId,
        type: "console.subscribe",
        v: 1,
      })
    )

    for (;;) {
      // The socket is one ordered stream; concurrent reads could reorder lines.
      // oxlint-disable-next-line react-doctor/async-await-in-loop
      const message = await inbox.next()
      yield relayConsoleStreamEventSchema.parse(message)
    }
  } finally {
    inbox.close()
    socket.close(1000, "Hearth console proxy closed")
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
  const receive = (data: Buffer, binary: boolean) => {
    if (binary) {
      fail(new Error("Relay returned an unsupported binary console frame"))
      return
    }
    try {
      const value = JSON.parse(data.toString()) as unknown
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Relay returned an invalid console message")
      }
      const message = Object.fromEntries(Object.entries(value))
      const waiter = waiters.shift()
      if (waiter) waiter.resolve(message)
      else messages.push(message)
    } catch (cause) {
      fail(asError(cause))
    }
  }
  const failed = (cause: Error) => fail(cause)
  const closed = (code: number, reason: Buffer) =>
    fail(
      new Error(
        reason.length
          ? reason.toString()
          : `Relay console connection closed (${code})`
      )
    )
  const abort = () => {
    fail(new Error("Console proxy was cancelled"))
    socket.close(1000, "Console proxy cancelled")
  }
  socket.on("message", receive)
  socket.once("error", failed)
  socket.once("close", closed)
  signal.addEventListener("abort", abort, { once: true })
  return {
    close: () => {
      signal.removeEventListener("abort", abort)
      socket.off("message", receive)
      socket.off("error", failed)
      socket.off("close", closed)
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
  if (!encoded) throw new Error("Hearth created an invalid Relay capability")
  const value = JSON.parse(
    Buffer.from(encoded, "base64url").toString()
  ) as unknown
  if (!value || typeof value !== "object" || !("capabilityId" in value)) {
    throw new Error("Hearth created an invalid Relay capability")
  }
  const id = Object.fromEntries(Object.entries(value)).capabilityId
  if (typeof id !== "string") {
    throw new Error("Hearth created an invalid Relay capability")
  }
  return id
}

function requiredCoordinate(value: string | undefined): string {
  if (!value) throw new Error("Hearth could not create a console proxy key")
  return value
}

function formatHost(hostname: string): string {
  return hostname.includes(":") && !hostname.startsWith("[")
    ? `[${hostname}]`
    : hostname
}

function asError(cause: unknown): Error {
  return cause instanceof Error
    ? cause
    : new Error("Relay console proxy failed")
}
