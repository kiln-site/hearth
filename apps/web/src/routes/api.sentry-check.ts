import * as Sentry from "@sentry/tanstackstart-react"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/sentry-check")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = process.env.KILN_SENTRY_VERIFICATION_TOKEN?.trim()
        if (
          !token ||
          request.headers.get("authorization") !== `Bearer ${token}`
        ) {
          return new Response(null, { status: 404 })
        }

        const eventId = Sentry.captureException(
          new Error("Kiln server Sentry verification"),
          { tags: { "kiln.verification": "server" } }
        )
        await Sentry.flush(2_000)
        return Response.json({ eventId })
      },
    },
  },
})
