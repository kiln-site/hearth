import { assert, describe, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { Database } from "@/effect/database"

import { requireRelayPermissionEffect } from "./access-control"

const EmptyDatabase = Layer.succeed(Database)({
  execute: () => Effect.die(new Error("execute was not expected")),
  queryRows: () => Effect.succeed([]),
})

const user = {
  email: "operator@kiln.local",
  emailVerified: true,
  id: "operator",
  isDevelopmentBypass: false,
  name: "Operator",
  role: "user" as const,
  twoFactorEnabled: false,
}

describe("requireRelayPermissionEffect", () => {
  layer(EmptyDatabase)((it) => {
    it.effect("returns a typed denial when no grant exists", () =>
      Effect.gen(function* () {
        const error = yield* requireRelayPermissionEffect({
          user,
          relayId: "relay",
          permission: "instance.read",
          instanceId: "instance",
        }).pipe(Effect.flip)

        assert.strictEqual(error._tag, "PermissionDeniedError")
      })
    )
  })
})
