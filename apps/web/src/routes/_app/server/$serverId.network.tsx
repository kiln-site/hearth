import { createFileRoute } from "@tanstack/react-router"

import { InstanceNetworkPage } from "@/components/instance-network-page"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/_app/server/$serverId/network")({
  component: InstanceNetworkPage,
  head: () => ({ meta: [{ title: pageTitle("Network") }] }),
})
