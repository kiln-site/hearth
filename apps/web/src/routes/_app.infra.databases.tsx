import { createFileRoute } from "@tanstack/react-router"
import { Database } from "lucide-react"

import { SettingsPlaceholderPage } from "@/components/settings-placeholder-page"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/_app/infra/databases")({
  head: () => ({ meta: [{ title: pageTitle("Databases") }] }),
  component: InfraDatabasesRoute,
})

function InfraDatabasesRoute() {
  return (
    <SettingsPlaceholderPage
      title="Databases"
      description="Managed database provisioning and credentials will live here."
      icon={Database}
    />
  )
}
