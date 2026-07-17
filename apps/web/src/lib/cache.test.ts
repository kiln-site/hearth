import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { AppCache } from "@/effect/cache"
import { CacheError } from "@/effect/errors"

import { invalidateCached, readThroughCache } from "./cache"

const policy = { key: "example", name: "Example", ttlMs: 1_000 }

function decodeString(input: unknown): string {
  if (typeof input !== "string") throw new Error("Expected a string")
  return input
}

function testCache(options?: { fail?: boolean; initial?: string }) {
  const values = new Map<string, string>()
  if (options?.initial !== undefined) values.set(policy.key, options.initial)
  const state = { gets: 0, removes: 0, sets: 0 }
  const failure = CacheError.make({
    operation: "TEST",
    cause: new Error("Cache unavailable"),
  })
  const layer = Layer.succeed(AppCache)({
    backend: "redis-protocol",
    enabled: true,
    get: (key) => {
      state.gets += 1
      return options?.fail
        ? Effect.fail(failure)
        : Effect.succeed(values.get(key))
    },
    remove: (key) => {
      state.removes += 1
      if (options?.fail) return Effect.fail(failure)
      values.delete(key)
      return Effect.void
    },
    set: (key, value) => {
      state.sets += 1
      if (options?.fail) return Effect.fail(failure)
      values.set(key, value)
      return Effect.void
    },
  })
  return { layer, state, values }
}

describe("readThroughCache", () => {
  it.effect("returns a valid cached value without loading", () => {
    const cache = testCache({ initial: JSON.stringify("cached") })
    let loads = 0
    return Effect.gen(function* () {
      const result = yield* readThroughCache({
        decode: decodeString,
        load: Effect.sync(() => {
          loads += 1
          return "loaded"
        }),
        policy,
      })
      assert.strictEqual(result, "cached")
      assert.strictEqual(loads, 0)
      assert.strictEqual(cache.state.gets, 1)
    }).pipe(Effect.provide(cache.layer))
  })

  it.effect("loads and stores a cache miss", () => {
    const cache = testCache()
    return Effect.gen(function* () {
      const result = yield* readThroughCache({
        decode: decodeString,
        load: Effect.succeed("loaded"),
        policy,
      })
      assert.strictEqual(result, "loaded")
      assert.strictEqual(cache.state.sets, 1)
      assert.strictEqual(cache.values.get(policy.key), JSON.stringify("loaded"))
    }).pipe(Effect.provide(cache.layer))
  })

  it.effect("evicts corrupt data and replaces it from the source", () => {
    const cache = testCache({ initial: "not-json" })
    return Effect.gen(function* () {
      const result = yield* readThroughCache({
        decode: decodeString,
        load: Effect.succeed("fresh"),
        policy,
      })
      assert.strictEqual(result, "fresh")
      assert.strictEqual(cache.state.removes, 1)
      assert.strictEqual(cache.values.get(policy.key), JSON.stringify("fresh"))
    }).pipe(Effect.provide(cache.layer))
  })

  it.effect("bypasses the cache for an explicit refresh", () => {
    const cache = testCache({ initial: JSON.stringify("stale") })
    return Effect.gen(function* () {
      const result = yield* readThroughCache({
        bypass: true,
        decode: decodeString,
        load: Effect.succeed("fresh"),
        policy,
      })
      assert.strictEqual(result, "fresh")
      assert.strictEqual(cache.state.gets, 0)
      assert.strictEqual(cache.state.sets, 1)
      assert.strictEqual(cache.values.get(policy.key), JSON.stringify("fresh"))
    }).pipe(Effect.provide(cache.layer))
  })

  it.effect("fails open when the cache is unavailable", () => {
    const cache = testCache({ fail: true })
    return Effect.gen(function* () {
      const result = yield* readThroughCache({
        decode: decodeString,
        load: Effect.succeed("source"),
        policy,
      })
      assert.strictEqual(result, "source")
      assert.strictEqual(cache.state.gets, 1)
      assert.strictEqual(cache.state.sets, 1)
    }).pipe(Effect.provide(cache.layer))
  })

  it.effect("removes an invalidated value", () => {
    const cache = testCache({ initial: JSON.stringify("cached") })
    return Effect.gen(function* () {
      yield* invalidateCached(policy)
      assert.strictEqual(cache.values.has(policy.key), false)
      assert.strictEqual(cache.state.removes, 1)
    }).pipe(Effect.provide(cache.layer))
  })
})
