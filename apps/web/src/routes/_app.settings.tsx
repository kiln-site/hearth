import { createFileRoute, redirect } from "@tanstack/react-router"

import { SettingsLayout } from "@/components/settings-layout"

export const Route = createFileRoute("/_app/settings")({
  beforeLoad: ({ context }) => {
    if (!context.user.isDevelopmentBypass && context.user.role !== "admin") {
      throw redirect({ to: "/" })
    }
  },
  component: SettingsLayout,
})
