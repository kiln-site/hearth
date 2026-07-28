import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

import { InstanceNetworkPage } from "@/components/instance-network-page"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/_app/server/$serverId/network")({
  validateSearch: z.object({
    member: z.string().max(512).optional(),
  }),
  component: NetworkRoute,
  head: () => ({ meta: [{ title: pageTitle("Network") }] }),
})

function NetworkRoute() {
  const { member } = Route.useSearch()
  return <InstanceNetworkPage highlightedTailscaleMember={member} />
}
