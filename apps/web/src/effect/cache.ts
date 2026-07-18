import * as Sentry from "@sentry/tanstackstart-react"
import * as NodeRedis from "@effect/platform-node/NodeRedis"
import { Context, Effect, Layer } from "effect"
import type { RedisOptions } from "ioredis"

import { cacheConnectionConfig } from "@/lib/cache-config"
import type { CacheConnectionConfig } from "@/lib/cache-config"

import { CacheError } from "./errors"

type CacheBackend = "disabled" | "redis-protocol"

export class AppCache extends Context.Service<
  AppCache,
  {
    readonly backend: CacheBackend
    readonly enabled: boolean
    readonly get: (key: string) => Effect.Effect<string | undefined, CacheError>
    readonly remove: (key: string) => Effect.Effect<void, CacheError>
    readonly set: (
      key: string,
      value: string,
      ttlMs: number
    ) => Effect.Effect<void, CacheError>
  }
>()("kiln/AppCache") {}

const AppCacheDisabled = Layer.succeed(AppCache)({
  backend: "disabled",
  enabled: false,
  get: () => Effect.succeed(undefined),
  remove: () => Effect.void,
  set: () => Effect.void,
})

const configuredCache = cacheConnectionConfig()

export const AppCacheLive = configuredCache
  ? makeRedisCacheLayer(configuredCache)
  : AppCacheDisabled

function makeRedisCacheLayer(
  config: CacheConnectionConfig
): Layer.Layer<AppCache> {
  const RedisClientLive = NodeRedis.layer(redisOptions(config))
  const CacheRedis = Layer.effect(AppCache)(
    Effect.gen(function* () {
      const redis = yield* NodeRedis.NodeRedis
      let retryAt = 0
      redis.client.on("error", () => undefined)

      const command = <TResult>(
        operation: string,
        run: () => Promise<TResult>,
        resultAttributes?: (
          result: TResult
        ) => Record<string, boolean | number | string>
      ): Effect.Effect<TResult, CacheError> =>
        Effect.suspend(() => {
          if (Date.now() < retryAt) {
            return Effect.fail(
              CacheError.make({
                operation,
                cause: new Error("Cache circuit is temporarily open"),
              })
            )
          }
          return redis
            .use(() =>
              Sentry.startSpan(
                {
                  name: `${operation} cache`,
                  op: "cache.redis",
                  attributes: { "cache.backend": "redis-protocol" },
                },
                async (span) => {
                  const result = await run()
                  const attributes = resultAttributes?.(result) ?? {}
                  for (const [name, value] of Object.entries(attributes)) {
                    span.setAttribute(name, value)
                  }
                  return result
                }
              )
            )
            .pipe(
              Effect.mapError((cause) => CacheError.make({ operation, cause })),
              Effect.tap(() =>
                Effect.sync(() => {
                  retryAt = 0
                })
              ),
              Effect.tapError(() =>
                Effect.sync(() => {
                  retryAt = Date.now() + 5_000
                })
              )
            )
        })

      const fullKey = (key: string) => `${config.namespace}:${key}`

      const backend: CacheBackend = "redis-protocol"
      return {
        backend,
        enabled: true,
        get: (key: string) =>
          command(
            "GET",
            () => redis.client.get(fullKey(key)),
            (value) => ({
              "cache.hit": value !== null,
            })
          ).pipe(Effect.map((value) => value ?? undefined)),
        remove: (key: string) =>
          command("DEL", async () => {
            await redis.client.del(fullKey(key))
          }),
        set: (key: string, value: string, ttlMs: number) =>
          command("SET", async () => {
            await redis.client.set(fullKey(key), value, "PX", ttlMs)
          }),
      }
    })
  )
  return Layer.provide(CacheRedis, RedisClientLive)
}

function redisOptions(config: CacheConnectionConfig): RedisOptions {
  return {
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    db: config.database,
    tls: config.tls ? { servername: config.host } : undefined,
    commandTimeout: 750,
    connectTimeout: 750,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 100, 1_000),
  }
}
