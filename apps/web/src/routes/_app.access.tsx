import { useQuery } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"

import { AccessPage } from "@/components/access-page"
import { pageTitle } from "@/lib/page-title"
import type { RelayFleetSnapshot } from "@/lib/relay-fleet"
import {
  accessCapabilitiesQueryOptions,
  accessOverviewQueryOptions,
  relaySnapshotQueryOptions,
} from "@/lib/query-options"

export const Route = createFileRoute("/_app/access")({
  beforeLoad: async ({ context }) => {
    const capabilities = await context.queryClient.ensureQueryData(
      accessCapabilitiesQueryOptions()
    )
    if (!capabilities.canManageAccess) {
      throw redirect({ to: "/" })
    }
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(accessOverviewQueryOptions()),
  head: () => ({ meta: [{ title: pageTitle("Access") }] }),
  component: AccessRoute,
})

function AccessRoute() {
  const { data: instances = emptyAccessInstances } = useQuery({
    ...relaySnapshotQueryOptions(),
    select: selectAccessInstances,
  })
  return <AccessPage instances={instances} />
}

const emptyAccessInstances: ReturnType<typeof selectAccessInstances> = []

function selectAccessInstances(snapshot: RelayFleetSnapshot) {
  return snapshot.instances.map((instance) => ({
    id: instance.id,
    name: instance.name,
    relayId: instance.relayId,
  }))
}
