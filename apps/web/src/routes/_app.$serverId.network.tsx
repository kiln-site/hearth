import { createFileRoute } from "@tanstack/react-router"

import { InstanceNetworkPage } from "@/components/instance-network-page"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/_app/$serverId/network")({
  head: () => ({ meta: [{ title: pageTitle("Network") }] }),
  component: InstanceNetworkPage,
})
