import { createFileRoute } from "@tanstack/react-router"

import { SettingsRouteOutlet } from "@/components/settings-layout"

export const Route = createFileRoute("/_app/settings")({
  component: SettingsRouteOutlet,
})
