import { createFileRoute, redirect } from "@tanstack/react-router"

import { SettingsLayout } from "@/components/settings-layout"
import { getAuthState } from "@/server/auth"

export const Route = createFileRoute("/_app/settings")({
  beforeLoad: async () => {
    const { user } = await getAuthState()
    if (!user?.isDevelopmentBypass && user?.role !== "admin") {
      throw redirect({ to: "/" })
    }
  },
  component: SettingsLayout,
})
