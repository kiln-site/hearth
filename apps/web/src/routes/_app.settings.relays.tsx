import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/settings/relays")({
  beforeLoad: () => {
    throw redirect({ to: "/infra/relays", replace: true })
  },
})
