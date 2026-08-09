import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { vi } from "vite-plus/test"

vi.hoisted(() => {
  process.env.DB_HOST ??= "127.0.0.1"
  process.env.DB_NAME ??= "test"
  process.env.DB_PASSWORD ??= "test"
  process.env.DB_USERNAME ??= "test"
})

import { collectAvailableCliRelaySnapshotsEffect } from "@/effect/cli-api"
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
