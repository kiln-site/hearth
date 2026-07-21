import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"

import {
  useInstanceIdentity,
  useInstancePermissions,
  useInstanceRelayConnected,
} from "@/components/instance-workspace"
import { SettingsWorkspace } from "@/components/settings-workspace"
import { pageTitle } from "@/lib/page-title"
import { relaySnapshotQueryOptions } from "@/lib/query-options"
import { selectInstanceSettings } from "@/lib/relay-selectors"

export const Route = createFileRoute("/_app/$serverId/info")({
  head: () => ({ meta: [{ title: pageTitle("Info") }] }),
  component: InfoRoute,
})

function InfoRoute() {
  const workspaceInstance = useInstanceIdentity()
  const permissions = useInstancePermissions()
  const relayConnected = useInstanceRelayConnected()
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
      relayConnected={relayConnected}
    />
  )
}
