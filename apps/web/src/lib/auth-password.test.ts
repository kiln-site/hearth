import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { Database } from "@/effect/database"
import { requireAccountPasswordEffect } from "@/lib/auth-password"

function testDatabase() {
  const state = { queries: 0 }
  const layer = Layer.succeed(Database)({
    execute: () => Effect.die("Unexpected database write"),
    queryRows: () =>
      Effect.sync(() => {
        state.queries += 1
        return []
      }),
    transaction: () => Effect.die("Unexpected database transaction"),
  })
  return { layer, state }
}

describe("account password confirmation", () => {
  it.effect(
    "accepts zzz for the development bypass without a database account",
    () => {
      const database = testDatabase()
      return Effect.gen(function* () {
        yield* requireAccountPasswordEffect(
          {
            id: "kiln-development-bypass",
            isDevelopmentBypass: true,
          },
          "zzz"
        )
        assert.strictEqual(database.state.queries, 0)
      }).pipe(Effect.provide(database.layer))
    }
  )

  it.effect("rejects other passwords for the development bypass", () => {
    const database = testDatabase()
    return Effect.gen(function* () {
      const failure = yield* requireAccountPasswordEffect(
        {
          id: "kiln-development-bypass",
          isDevelopmentBypass: true,
        },
        "not-zzz"
      ).pipe(Effect.flip)
      assert.strictEqual(failure._tag, "AuthenticationError")
      assert.strictEqual(database.state.queries, 0)
    }).pipe(Effect.provide(database.layer))
  })

  it.effect("does not accept zzz for persisted accounts", () => {
    const database = testDatabase()
    return Effect.gen(function* () {
      const failure = yield* requireAccountPasswordEffect(
        {
          id: "persisted-account",
          isDevelopmentBypass: false,
        },
        "zzz"
      ).pipe(Effect.flip)
      assert.strictEqual(failure._tag, "AuthenticationError")
      assert.strictEqual(database.state.queries, 1)
    }).pipe(Effect.provide(database.layer))
  })
})
