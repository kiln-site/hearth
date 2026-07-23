import { createFileRoute } from "@tanstack/react-router"

import { StartupWorkspace } from "@/components/startup-workspace"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/_app/server/$serverId/startup")({
  component: StartupRoute,
  head: () => ({ meta: [{ title: pageTitle("Startup") }] }),
})

function StartupRoute() {
  return <StartupWorkspace />
}
