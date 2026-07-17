import { Effect, Option } from "effect"

import { AppCache } from "@/effect/cache"
import type { CacheError } from "@/effect/errors"

export interface CachePolicy {
  key: string
  name: string
  ttlMs: number
}

interface ReadThroughCacheOptions<TResult, TError, TRequirements> {
  bypass?: boolean
  decode: (input: unknown) => TResult
  load: Effect.Effect<TResult, TError, TRequirements>
  policy: CachePolicy
}

const cacheWarningIntervalMs = 60_000
let lastCacheWarningAt = 0

export const readThroughCache = Effect.fn("cache.readThrough")(function* <
  TResult,
  TError,
  TRequirements,
>(options: ReadThroughCacheOptions<TResult, TError, TRequirements>) {
  const cache = yield* AppCache
  if (!cache.enabled) return yield* options.load
  if (options.bypass) {
    const value = yield* options.load
    yield* writeCachedJson(options.policy, value)
    return value
  }

  const cached = yield* cache
    .get(options.policy.key)
    .pipe(
      Effect.catch((error) =>
        warnCacheFailure(options.policy.name, error).pipe(Effect.as(undefined))
      )
    )
  if (cached !== undefined) {
    const decoded = yield* Effect.option(
      Effect.try({
        try: () => {
          const parsed: unknown = JSON.parse(cached)
          return options.decode(parsed)
        },
        catch: (cause) => cause,
      })
    )
    if (Option.isSome(decoded)) return decoded.value
    yield* ignoreCacheFailure(
      options.policy.name,
      cache.remove(options.policy.key)
    )
  }

  const value = yield* options.load
  yield* writeCachedJson(options.policy, value)
  return value
})

export const invalidateCached = Effect.fn("cache.invalidate")(function* (
  policy: CachePolicy
) {
  const cache = yield* AppCache
  if (!cache.enabled) return
  yield* ignoreCacheFailure(policy.name, cache.remove(policy.key))
})

export const writeCachedJson = Effect.fn("cache.write")(function* <TValue>(
  policy: CachePolicy,
  value: TValue
) {
  const cache = yield* AppCache
  if (!cache.enabled) return
  const encoded = yield* Effect.option(
    Effect.try({
      try: (): unknown => JSON.stringify(value),
      catch: (cause) => cause,
    })
  )
  if (Option.isNone(encoded) || typeof encoded.value !== "string") return
  yield* ignoreCacheFailure(
    policy.name,
    cache.set(policy.key, encoded.value, policy.ttlMs)
  )
})

function ignoreCacheFailure<TResult>(
  name: string,
  effect: Effect.Effect<TResult, CacheError>
): Effect.Effect<void> {
  return effect.pipe(
    Effect.asVoid,
    Effect.catch((error) => warnCacheFailure(name, error))
  )
}

function warnCacheFailure(
  name: string,
  error: CacheError
): Effect.Effect<void> {
  return Effect.suspend(() => {
    const now = Date.now()
    if (now - lastCacheWarningAt < cacheWarningIntervalMs) return Effect.void
    lastCacheWarningAt = now
    return Effect.logWarning(
      "Distributed cache unavailable; using source data",
      {
        cache: name,
        error: error.message,
      }
    )
  })
}
