import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { vi } from "vite-plus/test"
import {
  cliBrickReferenceSchema,
  cliRemoteFileUploadRequestSchema,
  cliServerInfoResponseSchema,
} from "@workspace/contracts"

vi.hoisted(() => {
  process.env.DB_HOST ??= "127.0.0.1"
  process.env.DB_NAME ??= "test"
  process.env.DB_PASSWORD ??= "test"
  process.env.DB_USERNAME ??= "test"
})

import {
  cliActivityResponse,
  cliSftpConnectionResponse,
  collectAvailableCliRelaySnapshotsEffect,
  relayRemoteUploadInput,
  safeCliBrickSource,
} from "@/effect/cli-api"
import { CliAccessError } from "@/effect/errors"

describe("CLI server listing", () => {
  it.effect(
    "returns healthy Relay snapshots when another Relay is unavailable",
    () =>
      Effect.gen(function* () {
        const snapshots = yield* collectAvailableCliRelaySnapshotsEffect([
          {
            relayId: "healthy-relay",
            snapshot: Effect.succeed({ id: "healthy-relay" }),
          },
          {
            relayId: "unhealthy-relay",
            snapshot: Effect.fail(
              CliAccessError.make({
                code: "relay_unavailable",
                message: "Relay did not respond.",
                retryable: true,
              })
            ),
          },
        ])

        assert.deepEqual(snapshots, [{ id: "healthy-relay" }])
      })
  )
})

describe("CLI SFTP connection", () => {
  it("omits Relay-only SFTP fields from the CLI response", () => {
    const response = cliSftpConnectionResponse(
      {
        developmentAuthentication: false,
        host: "relay.example.com",
        hostKeyFingerprint: "SHA256:relay-fingerprint",
        port: 2022,
      },
      "bedf06fe944ceb0a573a14da5a38703068a00e5a",
      "operator@example.com"
    )

    assert.deepEqual(response, {
      host: "relay.example.com",
      hostKeyFingerprint: "SHA256:relay-fingerprint",
      port: 2022,
      root: "/bedf06fe944ceb0a573a14da5a38703068a00e5a",
      username: "operator@example.com",
    })
  })
})

describe("CLI response and URL boundaries", () => {
  it("removes Hearth-only fields before returning activity", () => {
    const response = cliActivityResponse(
      [
        {
          actor: { email: null, id: "system", name: "Kiln system" },
          id: `${"r".repeat(43)}:audit-one`,
          label: "Created a server",
          occurredAt: 1,
          permission: "instance.create",
          rawEvent: "control.mutation",
          relay: { id: "r".repeat(43), name: "Relay" },
          server: null,
          source: "cli",
          type: "server",
        },
      ],
      1
    )

    assert.notProperty(response.entries[0] ?? {}, "rawEvent")
  })

  it("removes Hearth routing fields from Relay upload payloads", () => {
    const input = relayRemoteUploadInput({
      instanceId: "a".repeat(40),
      path: "plugins/example.jar",
      relayId: "r".repeat(43),
      url: "https://example.com/example.jar",
    })

    assert.deepEqual(input, {
      instanceId: "a".repeat(40),
      path: "plugins/example.jar",
      url: "https://example.com/example.jar",
    })
  })

  it("rejects insecure URLs and paths that escape the server root", () => {
    const target = {
      instanceId: "a".repeat(40),
      relayId: "r".repeat(43),
    }
    assert.isFalse(
      cliRemoteFileUploadRequestSchema.safeParse({
        ...target,
        path: "plugins/example.jar",
        url: "http://example.com/example.jar",
      }).success
    )
    assert.isFalse(
      cliRemoteFileUploadRequestSchema.safeParse({
        ...target,
        path: "../example.jar",
        url: "https://example.com/example.jar",
      }).success
    )
    assert.isFalse(
      cliRemoteFileUploadRequestSchema.safeParse({
        ...target,
        path: "plugins/example.jar",
        url: "https://user:password@example.com/example.jar",
      }).success
    )
    assert.isFalse(
      cliBrickReferenceSchema.safeParse(
        "https://user:password@example.com/paper.yml"
      ).success
    )
  })

  it("keeps server variables and internal runtime fields out of metadata", () => {
    const response = {
      relay: { id: "r".repeat(43), name: "Relay" },
      server: {
        brickId: "paper",
        brickSource: "https://example.com/paper.yml",
        connectAddress: "play.example.com",
        desiredState: "running",
        diskLimitBytes: 1024,
        game: "Minecraft",
        id: "a".repeat(40),
        implementation: "paper",
        javaVersion: "21",
        memoryLimitBytes: 1024,
        name: "Survival",
        observedState: "running",
        publicAddress: "play.example.com:25565",
        readyAt: null,
        resources: null,
        shortId: "a".repeat(8),
        startedAt: null,
        version: "1.21.11",
      },
    }
    assert.isTrue(cliServerInfoResponseSchema.safeParse(response).success)
    assert.isFalse(
      cliServerInfoResponseSchema.safeParse({
        ...response,
        server: {
          ...response.server,
          directory: "/data/private",
          variables: { secret: "value" },
        },
      }).success
    )
  })

  it("removes credentials and query secrets from Brick metadata", () => {
    assert.strictEqual(
      safeCliBrickSource(
        "https://user:password@example.com/paper.yml?token=secret#fragment"
      ),
      "https://example.com/paper.yml"
    )
  })
})
