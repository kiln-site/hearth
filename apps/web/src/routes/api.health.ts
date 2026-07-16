import { createFileRoute } from "@tanstack/react-router"

const HEALTH_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
} as const

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { databasePool } = await import("@/lib/database")
          await databasePool.query({ sql: "SELECT 1", timeout: 2_000 })
          return new Response('{"status":"ok"}', {
            headers: HEALTH_HEADERS,
            status: 200,
          })
        } catch {
          return new Response('{"status":"unhealthy"}', {
            headers: HEALTH_HEADERS,
            status: 503,
          })
        }
      },
    },
  },
})
