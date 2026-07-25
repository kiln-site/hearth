import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/infra/")({
  beforeLoad: () => {
    throw redirect({ to: "/infra/setup", replace: true })
  },
})
