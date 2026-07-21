import * as Sentry from "@sentry/tanstackstart-react"
import { Effect } from "effect"
import { z } from "zod"

import { RelayResponseError, RelayUnavailableError } from "@/effect/errors"
import {
  invalidateCached,
  readCachedFallback,
  readThroughCache,
  writeCachedJson,
} from "@/lib/cache"
import type { CachePolicy } from "@/lib/cache"
import { relayHeadersEffect } from "@/lib/relay-registry"

export interface RelayEndpoint {
  hostname: string
  id: string
  port: number
  useTls: boolean
}

export const relayCachePolicy = {
  brickCatalog: (relayId: string): CachePolicy => ({
    fallbackTtlMs: 7 * 24 * 60 * 60_000,
    key: `relay:${relayId}:bricks`,
    name: "Relay Brick catalog",
    ttlMs: 5 * 60_000,
  }),
  networking: (relayId: string): CachePolicy => ({
    fallbackTtlMs: 7 * 24 * 60 * 60_000,
    key: `relay:${relayId}:networking`,
    name: "Relay networking",
    ttlMs: 1_000,
  }),
  snapshot: (relayId: string): CachePolicy => ({
    fallbackTtlMs: 7 * 24 * 60 * 60_000,
    key: `relay:${relayId}:snapshot`,
    name: "Relay snapshot",
    ttlMs: 1_000,
  }),
  tree: (relayId: string, instanceId: string): CachePolicy => ({
    fallbackTtlMs: 24 * 60 * 60_000,
    key: `relay:${relayId}:instance:${instanceId}:tree`,
    name: "Relay file tree",
    ttlMs: 5_000,
  }),
}

export const relayFetchEffect = Effect.fn("relay.fetch")(function* (
  relay: RelayEndpoint,
  path: string,
  init?: RequestInit,
  timeoutMs = 10_000
) {
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout
  const headers = yield* relayHeadersEffect(relay)
  const response = yield* Effect.tryPromise({
    try: () =>
      Sentry.startSpan(
        {
          name: `${init?.method ?? "GET"} ${normalizedRelayRoute(path)}`,
          op: "http.client.relay",
          attributes: { "relay.id": relay.id },
        },
        () =>
          fetch(`${relayUrl(relay).replace(/\/$/u, "")}${path}`, {
            ...init,
            headers: {
              Accept: "application/json",
              ...(init?.body ? { "Content-Type": "application/json" } : {}),
              ...headers,
              ...init?.headers,
            },
            signal,
          })
      ),
    catch: (cause) =>
      RelayUnavailableError.make({
        message: timeout.aborted
          ? `Relay request timed out after ${timeoutMs}ms`
          : `Could not reach Relay: ${errorMessage(cause)}`,
        cause,
      }),
  })

  if (!response.ok) {
    const problem = yield* Effect.promise(() =>
      response.json().catch(() => null)
    )
    const parsed = z
      .object({ error: z.string().optional() })
      .nullable()
      .safeParse(problem)
    return yield* RelayResponseError.make({
      message:
        (parsed.success ? parsed.data?.error : undefined) ??
        `Relay returned HTTP ${response.status}`,
      status: response.status,
    })
  }

  return response
})

export const relayJsonEffect = Effect.fn("relay.json")(function* <TResult>(
  relay: RelayEndpoint,
  path: string,
  decode: (input: unknown) => TResult,
  init?: RequestInit,
  timeoutMs?: number
) {
  const response = yield* relayFetchEffect(relay, path, init, timeoutMs)
  const body = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) =>
      RelayResponseError.make({
        message: "Relay returned an invalid JSON response",
        status: 502,
        cause,
      }),
  })
  return yield* Effect.try({
    try: () => decode(body),
    catch: (cause) =>
      RelayResponseError.make({
        message: "Relay returned an unexpected response",
        status: 502,
        cause,
      }),
  })
})

export const cachedRelayJsonEffect = Effect.fn("relay.cachedJson")(function* <
  TResult,
>(options: {
  bypass?: boolean
  decode: (input: unknown) => TResult
  fallbackOnError?: boolean
  path: string
  policy: CachePolicy
  relay: RelayEndpoint
}) {
  return yield* readThroughCache({
    bypass: options.bypass,
    decode: options.decode,
    fallbackOnError: options.fallbackOnError,
    load: relayJsonEffect(options.relay, options.path, options.decode),
    policy: options.policy,
  })
})

export const cachedRelayFallbackJsonEffect = Effect.fn(
  "relay.cachedFallbackJson"
)(function* <TResult>(options: {
  decode: (input: unknown) => TResult
  policy: CachePolicy
}) {
  return yield* readCachedFallback(options.policy, options.decode)
})

export const invalidateRelayCache = invalidateCached
export const writeRelayCache = writeCachedJson

function normalizedRelayRoute(path: string): string {
  return path
    .split("?", 1)[0]
    .replace(/^\/v1\/instances\/[^/]+/u, "/v1/instances/:id")
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "unknown network error"
}

function relayUrl(relay: RelayEndpoint): string {
  return `${relay.useTls ? "https" : "http"}://${relay.hostname}:${relay.port}`
}
