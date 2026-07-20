import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { RelaySnapshot } from "@workspace/contracts"

import { useInstanceWorkspace } from "@/components/instance-workspace"
import { SettingsWorkspace } from "@/components/settings-workspace"
import { pageTitle } from "@/lib/page-title"
import { relaySnapshotQueryOptions } from "@/lib/query-options"

export const Route = createFileRoute("/_app/$serverId/info")({
  head: () => ({ meta: [{ title: pageTitle("Info") }] }),
  component: InfoRoute,
})

function InfoRoute() {
  const { instance: workspaceInstance, permissions } = useInstanceWorkspace()
  const selectInfo = React.useCallback(
    (snapshot: RelaySnapshot) => ({
      instance: snapshot.instances.find(
        (instance) => instance.id === workspaceInstance.id
      ),
      node: snapshot.node,
    }),
    [workspaceInstance.id]
  )
  const { data } = useQuery({
    ...relaySnapshotQueryOptions(),
    select: selectInfo,
  })
  if (!data?.instance) return null
  return (
    <SettingsWorkspace
      key={data.instance.id}
      instance={data.instance}
      node={data.node}
      canRename={permissions.settings}
    />
  )
}
