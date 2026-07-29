import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { vi } from "vite-plus/test"
import { relayInstanceSchema } from "@workspace/contracts"

vi.hoisted(() => {
  process.env.DB_HOST ??= "127.0.0.1"
  process.env.DB_NAME ??= "test"
  process.env.DB_PASSWORD ??= "test"
  process.env.DB_USERNAME ??= "test"
})

import { AppCache } from "@/effect/cache"
import { Database } from "@/effect/database"

import {
  applyManagedDomainAddressesEffect,
  loadManagedDomainAddressesEffect,
} from "./domains.server"

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

  it.effect("does not overlay a vanity address onto a changed endpoint", () => {
    const relayId = "relay-one"
    const instance = relayInstanceSchema.parse({
      connectAddress: "new-relay.example.com:32002",
      containerId: "container",
      desiredState: "running",
      directory: "test-server",
      game: "Minecraft",
      id: "b".repeat(40),
      implementation: "Paper",
      javaVersion: "21",
      name: "Test server",
      observedState: "running",
      publicHost: "new-relay.example.com",
      publicPort: 32_002,
      service: "test-server",
      shortId: "bbbbbbbb",
      status: "running",
      version: "1.21.11",
    })
    const values = new Map([
      [
        "domains:assignments:active-addresses",
        JSON.stringify({
          [`${relayId}:${instance.id}`]: {
            address: "vanity.kiln.site:32001",
            publicHost: "old-relay.example.com",
            publicPort: 32_001,
          },
        }),
      ],
    ])
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
      queryRows: () => Effect.die("Unexpected database query"),
      transaction: () => Effect.die("Unexpected database transaction"),
    })

    return Effect.gen(function* () {
      const [routed] = yield* applyManagedDomainAddressesEffect([
        {
          ...instance,
          relayId,
          relayName: "Relay one",
          relayStatus: "connected",
          routeId: `${relayId}-${instance.shortId}`,
        },
      ])
      assert.strictEqual(routed?.connectAddress, instance.connectAddress)

      const [matched] = yield* applyManagedDomainAddressesEffect([
        {
          ...instance,
          connectAddress: "old-relay.example.com:32001",
          publicHost: "old-relay.example.com",
          publicPort: 32_001,
          relayId,
          relayName: "Relay one",
          relayStatus: "connected",
          routeId: `${relayId}-${instance.shortId}`,
        },
      ])
      assert.strictEqual(
        matched?.connectAddress,
        "vanity.kiln.site:32001"
      )
    }).pipe(Effect.provide(Layer.merge(cacheLayer, databaseLayer)))
  })
})
