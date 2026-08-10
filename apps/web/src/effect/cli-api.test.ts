import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { vi } from "vite-plus/test"

vi.hoisted(() => {
  process.env.DB_HOST ??= "127.0.0.1"
  process.env.DB_NAME ??= "test"
  process.env.DB_PASSWORD ??= "test"
  process.env.DB_USERNAME ??= "test"
})

import {
  cliSftpConnectionResponse,
  collectAvailableCliRelaySnapshotsEffect,
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
