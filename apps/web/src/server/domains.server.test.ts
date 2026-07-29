import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { vi } from "vite-plus/test"

vi.hoisted(() => {
  process.env.DB_HOST ??= "127.0.0.1"
  process.env.DB_NAME ??= "test"
  process.env.DB_PASSWORD ??= "test"
  process.env.DB_USERNAME ??= "test"
})

import { AppCache } from "@/effect/cache"
import { Database } from "@/effect/database"

import { loadManagedDomainAddressesEffect } from "./domains.server"

describe("managed domain address cache", () => {
  it.effect("shares an empty assignment result across Relay polls", () => {
    const values = new Map<string, string>()
    let queries = 0
    const cacheLayer = Layer.succeed(AppCache)({
      backend: "redis-protocol",
      enabled: true,
      get: (key) => Effect.succeed(values.get(key)),
      remove: (key) =>
        Effect.sync(() => {
          values.delete(key)
        }),
      set: (key, value) =>
        Effect.sync(() => {
          values.set(key, value)
        }),
    })
    const databaseLayer = Layer.succeed(Database)({
      execute: () => Effect.die("Unexpected database write"),
      queryRows: () =>
        Effect.sync(() => {
          queries += 1
          return []
        }),
      transaction: () => Effect.die("Unexpected database transaction"),
    })

    return Effect.gen(function* () {
      assert.deepEqual(yield* loadManagedDomainAddressesEffect(), {})
      assert.deepEqual(yield* loadManagedDomainAddressesEffect(), {})
      assert.strictEqual(queries, 1)
    }).pipe(Effect.provide(Layer.merge(cacheLayer, databaseLayer)))
  })
})
