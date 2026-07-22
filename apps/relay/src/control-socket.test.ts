import { generateKeyPairSync, randomBytes, sign, verify } from "node:crypto"
import { createServer } from "node:http"
import { once } from "node:events"
import { Effect } from "effect"
import { WebSocket } from "ws"
import { describe, expect, it } from "vite-plus/test"

import {
  relayAuthChallengeTranscript,
  relayAuthResponseTranscript,
  relayControlProtocol,
} from "@workspace/contracts"
import type {
  RelayAuthChallenge,
  RelayControlServerMessage,
} from "@workspace/contracts"

import { attachControlSocket } from "./control-socket.js"
import { fingerprint } from "./effect/identity.js"
import { RelayStateStore } from "./effect/state.js"
import type { RelayClientRecord } from "./effect/state.js"

describe("Relay control socket", () => {
  it("authenticates a paired Hearth and executes an authorized request", async () => {
    const relayKeys = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    })
    const hearthKeys = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    })
    const client: RelayClientRecord = {
      actions: ["relay.read"],
      createdAt: Date.now(),
      id: fingerprint(hearthKeys.publicKey),
      lastAddress: null,
      lastSeenAt: null,
      name: "Test Hearth",
      origins: ["https://hearth.test"],
      publicKey: hearthKeys.publicKey,
      role: "read_only",
      sourceCidrs: [],
    }
    const state = RelayStateStore.of({
      appendAudit: () => Effect.void,
      createInvitation: () => Effect.void,
      findActiveInvitation: () => Effect.succeed(null),
      findClientById: (clientId) =>
        Effect.succeed(clientId === client.id ? client : null),
      findClientByPublicKey: () => Effect.succeed(null),
      getMetadata: () => Effect.succeed(null),
      listClients: () => Effect.succeed([client]),
      listAudits: () => Effect.succeed([]),
      listInvitations: () => Effect.succeed([]),
      pairClient: () => Effect.void,
      revokeClient: () => Effect.succeed(false),
      revokeInvitation: () => Effect.succeed(false),
      setMetadata: () => Effect.void,
      touchClient: () => Effect.void,
      updateClient: () => Effect.succeed(false),
    })
    const server = createServer()
    let pushSnapshot: ((snapshot: unknown) => void) | undefined
    const control = attachControlSocket({
      execute: async () => ({ ok: true }),
      identity: {
        fingerprint: fingerprint(relayKeys.publicKey),
        name: "Test Relay",
        privateKeyPem: relayKeys.privateKey,
        publicKeyPem: relayKeys.publicKey,
      },
      initialSnapshot: async () => ({ instances: [], node: {} }),
      subscribeSnapshots: (listener) => {
        pushSnapshot = listener
        return () => {
          pushSnapshot = undefined
        }
      },
      runEffect: (effect) => Effect.runPromise(effect),
      server,
      state,
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing port")
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/v1/socket`,
      relayControlProtocol
    )
    const inbox = messageInbox(socket)

    try {
      const challenge = (await inbox.next()) as RelayAuthChallenge
      expect(challenge.type).toBe("auth.challenge")
      expect(
        verify(
          null,
          Buffer.from(relayAuthChallengeTranscript(challenge)),
          relayKeys.publicKey,
          Buffer.from(challenge.signature, "base64url")
        )
      ).toBe(true)
      socket.send(
        JSON.stringify({
          clientId: client.id,
          signature: sign(
            null,
            Buffer.from(relayAuthResponseTranscript(challenge, client.id)),
            hearthKeys.privateKey
          ).toString("base64url"),
          type: "auth.response",
          v: 1,
        })
      )
      expect((await inbox.next()).type).toBe("auth.ready")
      expect((await inbox.next()).type).toBe("event")

      socket.send(
        JSON.stringify({
          deadline: Date.now() + 5_000,
          id: randomBytes(12).toString("hex"),
          operation: "relay.snapshot",
          payload: {},
          type: "request",
          v: 1,
        })
      )
      const response = await inbox.next()
      expect(response.type).toBe("response")
      if (response.type === "response") {
        expect(response.payload).toEqual({ ok: true })
      }
      pushSnapshot?.({ instances: [{ id: "updated" }], node: {} })
      const pushed = await inbox.next()
      expect(pushed.type).toBe("event")
      if (pushed.type === "event") {
        expect(pushed.seq).toBe(2)
        expect(pushed.payload).toEqual({
          instances: [{ id: "updated" }],
          node: {},
        })
      }
    } finally {
      socket.close()
      await once(socket, "close")
      await control.close()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })

  it("keeps independent Hearth sessions alive when one client is revoked", async () => {
    const relayKeys = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    })
    const clients = ["Hearth A", "Hearth B"].map((name) => {
      const keys = generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      })
      return {
        keys,
        record: {
          actions: ["relay.read"],
          createdAt: Date.now(),
          id: fingerprint(keys.publicKey),
          lastAddress: null,
          lastSeenAt: null,
          name,
          origins: ["https://hearth.test"],
          publicKey: keys.publicKey,
          role: "read_only",
          sourceCidrs: [],
        } satisfies RelayClientRecord,
      }
    })
    const state = RelayStateStore.of({
      appendAudit: () => Effect.void,
      createInvitation: () => Effect.void,
      findActiveInvitation: () => Effect.succeed(null),
      findClientById: (clientId) =>
        Effect.succeed(
          clients.find(({ record }) => record.id === clientId)?.record ?? null
        ),
      findClientByPublicKey: () => Effect.succeed(null),
      getMetadata: () => Effect.succeed(null),
      listClients: () => Effect.succeed(clients.map(({ record }) => record)),
      listAudits: () => Effect.succeed([]),
      listInvitations: () => Effect.succeed([]),
      pairClient: () => Effect.void,
      revokeClient: () => Effect.succeed(false),
      revokeInvitation: () => Effect.succeed(false),
      setMetadata: () => Effect.void,
      touchClient: () => Effect.void,
      updateClient: () => Effect.succeed(false),
    })
    const server = createServer()
    const control = attachControlSocket({
      execute: async (_request, client) => ({ clientId: client.id }),
      identity: {
        fingerprint: fingerprint(relayKeys.publicKey),
        name: "Test Relay",
        privateKeyPem: relayKeys.privateKey,
        publicKeyPem: relayKeys.publicKey,
      },
      initialSnapshot: async () => ({ instances: [], node: {} }),
      subscribeSnapshots: () => () => undefined,
      runEffect: (effect) => Effect.runPromise(effect),
      server,
      state,
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing port")

    const first = await authenticateTestSocket(
      address.port,
      clients[0].record,
      clients[0].keys.privateKey
    )
    const second = await authenticateTestSocket(
      address.port,
      clients[1].record,
      clients[1].keys.privateKey
    )

    try {
      expect(control.sessions.size).toBe(2)
      const firstClosed = once(first.socket, "close")
      control.revokeClient(clients[0].record.id)
      await firstClosed
      await expect.poll(() => control.sessions.size).toBe(1)

      second.socket.send(
        JSON.stringify({
          deadline: Date.now() + 5_000,
          id: randomBytes(12).toString("hex"),
          operation: "relay.snapshot",
          payload: {},
          type: "request",
          v: 1,
        })
      )
      const response = await second.inbox.next()
      expect(response.type).toBe("response")
      if (response.type === "response") {
        expect(response.payload).toEqual({ clientId: clients[1].record.id })
      }
    } finally {
      second.socket.close()
      await once(second.socket, "close")
      await control.close()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })
})

async function authenticateTestSocket(
  port: number,
  client: RelayClientRecord,
  privateKey: string
) {
  const socket = new WebSocket(
    `ws://127.0.0.1:${port}/v1/socket`,
    relayControlProtocol
  )
  const inbox = messageInbox(socket)
  const challenge = (await inbox.next()) as RelayAuthChallenge
  socket.send(
    JSON.stringify({
      clientId: client.id,
      signature: sign(
        null,
        Buffer.from(relayAuthResponseTranscript(challenge, client.id)),
        privateKey
      ).toString("base64url"),
      type: "auth.response",
      v: 1,
    })
  )
  expect((await inbox.next()).type).toBe("auth.ready")
  expect((await inbox.next()).type).toBe("event")
  return { inbox, socket }
}

function messageInbox(socket: WebSocket) {
  const messages: Array<RelayControlServerMessage> = []
  const waiters: Array<(message: RelayControlServerMessage) => void> = []
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString()) as RelayControlServerMessage
    const waiter = waiters.shift()
    if (waiter) waiter(message)
    else messages.push(message)
  })
  return {
    next: () =>
      new Promise<RelayControlServerMessage>((resolve, reject) => {
        const message = messages.shift()
        if (message) {
          resolve(message)
          return
        }
        const timer = setTimeout(
          () => reject(new Error("WebSocket timed out")),
          2_000
        )
        waiters.push((value) => {
          clearTimeout(timer)
          resolve(value)
        })
      }),
  }
}
