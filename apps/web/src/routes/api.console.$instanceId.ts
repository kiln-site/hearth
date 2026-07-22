import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/console/$instanceId")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          {
            error:
              "Console streaming now connects directly to Relay using a short-lived browser capability.",
          },
          { status: 410 }
        ),
    },
  },
})
