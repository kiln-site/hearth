import { createFileRoute } from "@tanstack/react-router"
import { Palette } from "lucide-react"

import { SettingsPlaceholderPage } from "@/components/settings-placeholder-page"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/_app/settings/appearance")({
  head: () => ({ meta: [{ title: pageTitle("Appearance Settings") }] }),
  component: AppearanceSettingsRoute,
})

function AppearanceSettingsRoute() {
  return (
    <SettingsPlaceholderPage
      title="Appearance"
      description="Theme and display controls will live here."
      icon={Palette}
    />
  )
}
