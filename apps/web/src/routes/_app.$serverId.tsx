import * as React from "react"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"

import { InstanceRouteFrame } from "@/components/instance-route-frame"
import type { AccessPermission } from "@/lib/permissions"
import { roleHasPermission } from "@/lib/permissions"
import {
  accessCapabilitiesQueryOptions,
  relaySnapshotQueryOptions,
  uiPreferencesQueryOptions,
} from "@/lib/query-options"
import {
  selectInstanceWorkspaceInstance,
} from "@/lib/relay-selectors"

export const Route = createFileRoute("/_app/$serverId")({
  component: InstanceRouteLayout,
})

function InstanceRouteLayout() {
  const serverId = Route.useParams({
    select: (params) => params.serverId,
  })
  const selectInstance = React.useMemo(
    () => selectInstanceWorkspaceInstance(serverId),
    [serverId]
  )
  const { data: instance } = useQuery({
    ...relaySnapshotQueryOptions(),
    select: selectInstance,
  })
  const { data: capabilities } = useSuspenseQuery(
    accessCapabilitiesQueryOptions()
  )
  const { data: uiPreferences } = useSuspenseQuery(uiPreferencesQueryOptions())
  const instanceId = instance?.id

  const fileTreePreferences = React.useMemo(
    () => ({
      collapsed: uiPreferences.fileTreeCollapsed,
      width: uiPreferences.fileTreeWidth,
    }),
    [uiPreferences.fileTreeCollapsed, uiPreferences.fileTreeWidth]
  )
  const permissions = React.useMemo(() => {
    const can = (permission: AccessPermission): boolean =>
      capabilities.isPlatformAdmin ||
      capabilities.grants.some(
        (grant) =>
          roleHasPermission(grant.role, permission) &&
          (grant.resourceType === "relay" || grant.resourceId === instanceId)
      )

    return {
      consoleWrite: can("instance.console.write"),
      filesWrite: can("instance.files.write"),
      power: can("instance.power"),
      settings: can("instance.settings"),
      shareLogs: can("instance.logs.share"),
    }
  }, [capabilities.grants, capabilities.isPlatformAdmin, instanceId])

  if (!instance) return null

  return (
    <InstanceRouteFrame
      instance={instance}
      fileTreePreferences={fileTreePreferences}
      permissions={permissions}
    />
  )
}
