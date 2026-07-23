import { createFileRoute, notFound } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/$")({
  beforeLoad: () => {
    throw notFound({ routeId: "/_app" })
  },
})
