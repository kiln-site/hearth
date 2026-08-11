import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { beforeEach, vi } from "vite-plus/test"

interface ClientRecord {
  destroyCalls: number
  endCalls: number
  sftpEndCalls: number
  transferStarted: boolean
}

interface Ssh2State {
  clients: Array<ClientRecord>
  mode: "connect" | "transfer"
}

const ssh2State = vi.hoisted(
  (): Ssh2State => ({ clients: [], mode: "connect" })
)

vi.mock("ssh2", async () => {
  const { EventEmitter } = await import("node:events")

  class MockSftp extends EventEmitter {
    constructor(private readonly record: ClientRecord) {
      super()
    }

    end(): void {
      this.record.sftpEndCalls += 1
    }

    fastGet(
      _remotePath: string,
      _localPath: string,
      _done: (cause?: Error | null) => void
    ): void {
      this.record.transferStarted = true
    }

    fastPut(
      _localPath: string,
      _remotePath: string,
      _done: (cause?: Error | null) => void
    ): void {
      this.record.transferStarted = true
    }
  }

  class MockClient extends EventEmitter {
    readonly record: ClientRecord = {
      destroyCalls: 0,
      endCalls: 0,
      sftpEndCalls: 0,
      transferStarted: false,
    }

    constructor() {
      super()
      ssh2State.clients.push(this.record)
    }

    connect(): this {
      if (ssh2State.mode === "transfer") {
        queueMicrotask(() => this.emit("ready"))
      }
      return this
    }

    destroy(): this {
      this.record.destroyCalls += 1
      return this
    }

    end(): this {
      this.record.endCalls += 1
      return this
    }

    sftp(done: (cause: Error | undefined, sftp: MockSftp) => void): this {
      done(undefined, new MockSftp(this.record))
      return this
    }
  }

  return { Client: MockClient }
})

import type { KilnSession } from "./config.js"
import { downloadSftpFileEffect } from "./sftp.js"

const session: KilnSession = {
  profile: "test",
  token: "kiln_cli_test",
  url: "https://kiln.example.test",
}

const connection = {
  host: "relay.example.test",
  hostKeyFingerprint: `SHA256:${Buffer.alloc(32).toString("base64")}`,
  port: 2022,
  root: "/srv/kiln/instances/test/root",
  username: "test@example.test",
}

describe("CLI SFTP cancellation", () => {
  beforeEach(() => {
    ssh2State.clients.length = 0
    ssh2State.mode = "connect"
  })

  it.effect("destroys a client interrupted during its handshake", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        downloadSftpFileEffect({
          connection,
          localPath: "/etc/hosts",
          remotePath: "server.jar",
          session,
        })
      )
      yield* Effect.yieldNow
      yield* Fiber.interrupt(fiber)

      const client = ssh2State.clients[0]
      assert.isDefined(client)
      assert.strictEqual(client.destroyCalls, 1)
      assert.strictEqual(client.endCalls, 0)
    })
  )

  it.effect("closes the SFTP channel and client during a transfer", () =>
    Effect.gen(function* () {
      ssh2State.mode = "transfer"
      const fiber = yield* Effect.forkChild(
        downloadSftpFileEffect({
          connection,
          localPath: "/etc/hosts",
          remotePath: "server.jar",
          session,
        })
      )
      yield* Effect.yieldNow
      yield* Effect.yieldNow

      const client = ssh2State.clients[0]
      assert.isDefined(client)
      assert.isTrue(client.transferStarted)
      yield* Fiber.interrupt(fiber)

      assert.strictEqual(client.sftpEndCalls, 1)
      assert.strictEqual(client.endCalls, 1)
    })
  )
})
