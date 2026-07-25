import { createFileRoute } from "@tanstack/react-router"
import { Wrench } from "lucide-react"

import { SettingsPlaceholderPage } from "@/components/settings-placeholder-page"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/_app/infra/setup")({
  head: () => ({ meta: [{ title: pageTitle("Infrastructure Setup") }] }),
  component: InfraSetupRoute,
})

function InfraSetupRoute() {
  return (
    <SettingsPlaceholderPage
      title="Setup"
      description="Guided infrastructure setup and connection checks will live here."
      icon={Wrench}
    />
  )
}
