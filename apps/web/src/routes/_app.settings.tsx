import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/settings")({
  beforeLoad: ({ context }) => {
    if (!context.user.isDevelopmentBypass && context.user.role !== "admin") {
      throw redirect({ to: "/" })
    }
  },
  component: Outlet,
})
