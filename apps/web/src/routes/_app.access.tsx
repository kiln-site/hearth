import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"

import { AccessPage } from "@/components/access-page"
import { pageTitle } from "@/lib/page-title"
import {
  accessCapabilitiesQueryOptions,
  accessOverviewQueryOptions,
  relayConnectionQueryOptions,
  relaySnapshotQueryOptions,
} from "@/lib/query-options"

export const Route = createFileRoute("/_app/access")({
  head: () => ({ meta: [{ title: pageTitle("Access") }] }),
  beforeLoad: async ({ context }) => {
    const [capabilities, connection] = await Promise.all([
      context.queryClient.ensureQueryData(accessCapabilitiesQueryOptions()),
      context.queryClient.ensureQueryData(
        relayConnectionQueryOptions(context.queryClient)
      ),
    ])
    if (!capabilities.canManageAccess) {
      throw redirect({ to: "/" })
    }
    if (connection.status !== "connected") {
      throw redirect({ to: capabilities.isPlatformAdmin ? "/settings" : "/" })
    }
  },
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(accessOverviewQueryOptions()),
      context.queryClient.ensureQueryData(relaySnapshotQueryOptions()),
    ])
  },
  component: AccessRoute,
})

function AccessRoute() {
  const { data: snapshot } = useSuspenseQuery(relaySnapshotQueryOptions())
  return <AccessPage instances={snapshot.instances} />
}
