import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const [{ auth }, { ensureConfiguredSuperUser }] = await Promise.all([
          import("@/lib/auth"),
          import("@/lib/auth-bootstrap"),
        ])
        await ensureConfiguredSuperUser()
        return auth.handler(request)
      },
      POST: async ({ request }) => {
        const [{ auth }, { ensureConfiguredSuperUser }] = await Promise.all([
          import("@/lib/auth"),
          import("@/lib/auth-bootstrap"),
        ])
        await ensureConfiguredSuperUser()
        return auth.handler(request)
      },
    },
  },
})
