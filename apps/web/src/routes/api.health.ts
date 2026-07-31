import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"

const HEALTH_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
} as const

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        return Effect.runPromise(
          Effect.tryPromise({
            try: async () => {
              const { databasePool } = await import("@/lib/database")
              await databasePool.query({ sql: "SELECT 1", timeout: 2_000 })
            },
            catch: (cause) => cause,
          }).pipe(
            Effect.match({
              onFailure: () =>
                new Response('{"status":"unhealthy"}', {
                  headers: HEALTH_HEADERS,
                  status: 503,
                }),
              onSuccess: () =>
                new Response('{"status":"ok"}', {
                  headers: HEALTH_HEADERS,
                  status: 200,
                }),
            })
          )
        )
      },
    },
  },
})
