import { createFileRoute } from "@tanstack/react-router"
import { CircleUserRound } from "lucide-react"

import { SettingsPlaceholderPage } from "@/components/settings-placeholder-page"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/_app/settings/account")({
  head: () => ({ meta: [{ title: pageTitle("Account Settings") }] }),
  component: AccountSettingsRoute,
})

function AccountSettingsRoute() {
  return (
    <SettingsPlaceholderPage
      title="Account"
      description="Profile and account controls will live here."
      icon={CircleUserRound}
    />
  )
}
