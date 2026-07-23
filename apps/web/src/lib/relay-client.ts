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
import { relayRpc } from "@/lib/relay-connection"

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
  const response = yield* Effect.tryPromise({
    try: () =>
      Sentry.startSpan(
        {
          name: `${init?.method ?? "GET"} ${normalizedRelayRoute(path)}`,
          op: "http.client.relay",
          attributes: { "relay.id": relay.id },
        },
        async () => {
          const request = relayControlRequest(path, init)
          const payload = await relayRpc(
            relay,
            request.operation,
            request.payload,
            timeoutMs
          )
          return new Response(JSON.stringify(payload), {
            headers: { "Content-Type": "application/json; charset=utf-8" },
            status: 200,
          })
        }
      ),
    catch: (cause) =>
      RelayUnavailableError.make({
        message: `Could not reach Relay: ${errorMessage(cause)}`,
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

function relayControlRequest(path: string, init?: RequestInit) {
  const url = new URL(path, "http://relay")
  const method = init?.method ?? "GET"
  const body = requestBody(init?.body)
  if (url.pathname === "/v1/snapshot" && method === "GET") {
    return { operation: "relay.snapshot" as const, payload: {} }
  }
  if (url.pathname === "/v1/bricks" && method === "GET") {
    return { operation: "brick.catalog" as const, payload: {} }
  }
  if (url.pathname === "/v1/bricks/recipe" && method === "GET") {
    return {
      operation: "brick.recipe" as const,
      payload: { source: url.searchParams.get("source") },
    }
  }
  if (url.pathname === "/v1/networking") {
    if (method === "GET") {
      return { operation: "relay.networking.read" as const, payload: {} }
    }
    if (method === "PUT") {
      return { operation: "relay.networking.write" as const, payload: body }
    }
  }
  if (url.pathname === "/v1/proxy") {
    if (method === "GET") {
      return { operation: "relay.proxy.read" as const, payload: {} }
    }
    if (method === "PUT") {
      return { operation: "relay.proxy.write" as const, payload: body }
    }
  }
  if (url.pathname === "/v1/instances" && method === "POST") {
    return { operation: "instance.create" as const, payload: body }
  }
  const match = url.pathname.match(
    /^\/v1\/instances\/([^/]+)(?:\/(tree|file|actions|console|console-completions|latest-log|web-routes|startup))?$/u
  )
  if (!match) throw new Error("Unsupported Relay request")
  const instanceId = decodeURIComponent(match[1])
  const resource = match[2]
  if (!resource && method === "DELETE") {
    return {
      operation: "instance.delete" as const,
      payload: {
        deleteData: url.searchParams.get("deleteData") === "true",
        instanceId,
      },
    }
  }
  if (resource === "startup" && method === "PUT") {
    return {
      operation: "instance.startup.write" as const,
      payload: { ...body, instanceId },
    }
  }
  if (resource === "tree" && method === "GET") {
    return {
      operation: "instance.files.list" as const,
      payload: { instanceId },
    }
  }
  if (resource === "file") {
    const payload = {
      ...body,
      instanceId,
      path: url.searchParams.get("path") ?? "",
    }
    return method === "PUT"
      ? { operation: "instance.files.write" as const, payload }
      : { operation: "instance.files.read" as const, payload }
  }
  if (resource === "actions" && method === "POST") {
    return {
      operation: "instance.action" as const,
      payload: { ...body, instanceId },
    }
  }
  if (resource === "console") {
    if (method === "POST") {
      return {
        operation: "instance.console.write" as const,
        payload: { ...body, instanceId },
      }
    }
    return {
      operation: "instance.console.history" as const,
      payload: {
        instanceId,
        limit: Number(url.searchParams.get("limit") ?? 2_000),
      },
    }
  }
  if (resource === "console-completions" && method === "POST") {
    return {
      operation: "instance.console.complete" as const,
      payload: { ...body, instanceId },
    }
  }
  if (resource === "latest-log" && method === "GET") {
    return {
      operation: "instance.logs.latest" as const,
      payload: { instanceId },
    }
  }
  if (resource === "web-routes") {
    return method === "PUT"
      ? {
          operation: "instance.network.routes.write" as const,
          payload: { instanceId, routes: body.routes },
        }
      : {
          operation: "instance.network.routes.read" as const,
          payload: { instanceId },
        }
  }
  throw new Error("Unsupported Relay request")
}

function requestBody(
  body: BodyInit | null | undefined
): Record<string, unknown> {
  if (!body) return {}
  if (typeof body !== "string") {
    throw new Error("Relay JSON requests require a string body")
  }
  const value = JSON.parse(body) as unknown
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Relay JSON request body must be an object")
  }
  return Object.fromEntries(Object.entries(value))
}
