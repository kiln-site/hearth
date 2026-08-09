import { createFileRoute } from "@tanstack/react-router"

import { AccountSettingsPage } from "@/components/account-settings-page"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/_app/settings/account")({
  head: () => ({ meta: [{ title: pageTitle("Account Settings") }] }),
  component: AccountSettingsRoute,
})

function AccountSettingsRoute() {
  const { user } = Route.useRouteContext()
  return <AccountSettingsPage user={user} />
}
