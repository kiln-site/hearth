import * as Sentry from "@sentry/tanstackstart-react"
import { createFileRoute } from "@tanstack/react-router"

import { matchesVerificationToken } from "@/observability/verification-token"

export const Route = createFileRoute("/api/sentry-check")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (
          !matchesVerificationToken(
            request.headers.get("authorization"),
            process.env.KILN_SENTRY_VERIFICATION_TOKEN
          )
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
