import { createFileRoute, redirect } from "@tanstack/react-router"

import { AppSettingsPage } from "@/components/app-settings-page"
import { pageTitle } from "@/lib/page-title"
import { getAuthState } from "@/server/auth"
import { relaysQueryOptions } from "@/lib/query-options"

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: pageTitle("Settings") }] }),
  beforeLoad: async () => {
    const { user } = await getAuthState()
    if (!user?.isDevelopmentBypass && user?.role !== "admin") {
      throw redirect({ to: "/" })
    }
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(relaysQueryOptions()),
  component: SettingsRoute,
})

function SettingsRoute() {
  return <AppSettingsPage />
}
