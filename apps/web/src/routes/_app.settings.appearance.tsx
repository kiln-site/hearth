import { createFileRoute } from "@tanstack/react-router"

import { AppearanceSettingsPage } from "@/components/appearance-settings-page"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/_app/settings/appearance")({
  head: () => ({ meta: [{ title: pageTitle("Appearance Settings") }] }),
  component: AppearanceSettingsRoute,
})

function AppearanceSettingsRoute() {
  return <AppearanceSettingsPage />
}
