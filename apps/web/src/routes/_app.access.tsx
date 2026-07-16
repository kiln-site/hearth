import { createFileRoute, redirect } from "@tanstack/react-router"

import { AccessPage } from "@/components/access-page"
import { getAccessCapabilities, getAccessOverview } from "@/server/access"
import { getRelayConnectionState, getRelaySnapshot } from "@/server/relay"

export const Route = createFileRoute("/_app/access")({
  beforeLoad: async () => {
    const [capabilities, connection] = await Promise.all([
      getAccessCapabilities(),
      getRelayConnectionState(),
    ])
    if (!capabilities.canManageAccess) {
      throw redirect({ to: "/" })
    }
    if (connection.status !== "connected") {
      throw redirect({ to: capabilities.isPlatformAdmin ? "/settings" : "/" })
    }
  },
  loader: async () => {
    const [overview, snapshot] = await Promise.all([
      getAccessOverview(),
      getRelaySnapshot(),
    ])
    return { overview, snapshot }
  },
  component: AccessRoute,
})

function AccessRoute() {
  const { overview, snapshot } = Route.useLoaderData()
  return (
    <AccessPage initialOverview={overview} instances={snapshot.instances} />
  )
}
