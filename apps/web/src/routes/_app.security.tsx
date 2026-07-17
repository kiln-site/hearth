import { createFileRoute } from "@tanstack/react-router"

import { SecurityPage } from "@/components/security-page"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/_app/security")({
  head: () => ({ meta: [{ title: pageTitle("Security") }] }),
  component: SecurityRoute,
})

function SecurityRoute() {
  const { user } = Route.useRouteContext()
  return <SecurityPage user={user} />
}
