import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"

import { useInstanceWorkspace } from "@/components/instance-workspace"
import { SettingsWorkspace } from "@/components/settings-workspace"
import { useRelayConnection } from "@/components/relay-connection-status"
import { pageTitle } from "@/lib/page-title"
import { relaySnapshotQueryOptions } from "@/lib/query-options"
import { selectInstanceSettings } from "@/lib/relay-selectors"

export const Route = createFileRoute("/_app/$serverId/info")({
  head: () => ({ meta: [{ title: pageTitle("Info") }] }),
  component: InfoRoute,
})

function InfoRoute() {
  const { status: relayStatus } = useRelayConnection()
  const { instance: workspaceInstance, permissions } = useInstanceWorkspace()
  const selectInfo = React.useMemo(
    () =>
      selectInstanceSettings(workspaceInstance.id, workspaceInstance.relayId),
    [workspaceInstance.id, workspaceInstance.relayId]
  )
  const { data } = useQuery({
    ...relaySnapshotQueryOptions(),
    select: selectInfo,
  })
  if (!data) return null
  return (
    <SettingsWorkspace
      key={`${data.instance.relayId}:${data.instance.id}`}
      instance={data.instance}
      node={data.node}
      canRename={permissions.settings}
      relayConnected={relayStatus === "connected"}
    />
  )
}
