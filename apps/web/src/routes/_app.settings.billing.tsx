import { createFileRoute } from "@tanstack/react-router"
import { CreditCard } from "lucide-react"

import { SettingsPlaceholderPage } from "@/components/settings-placeholder-page"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/_app/settings/billing")({
  head: () => ({ meta: [{ title: pageTitle("Billing Settings") }] }),
  component: BillingSettingsRoute,
})

function BillingSettingsRoute() {
  return (
    <SettingsPlaceholderPage
      title="Billing"
      description="Plan and billing controls will live here."
      icon={CreditCard}
    />
  )
}
