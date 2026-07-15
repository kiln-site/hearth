import { createFileRoute, redirect } from "@tanstack/react-router"

import { AppSettingsPage } from "@/components/app-settings-page"
import { getAuthState } from "@/server/auth"
import { getRelays } from "@/server/relays"

export const Route = createFileRoute("/_app/settings")({
  beforeLoad: async () => {
    const { user } = await getAuthState()
    if (!user?.isDevelopmentBypass && user?.role !== "admin") {
      throw redirect({ to: "/" })
    }
  },
  loader: () => getRelays(),
  component: SettingsRoute,
})

function SettingsRoute() {
  return <AppSettingsPage initialRelays={Route.useLoaderData()} />
}
