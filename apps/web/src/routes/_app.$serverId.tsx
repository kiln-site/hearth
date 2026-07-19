import * as React from "react"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router"
import type { RelayInstance } from "@workspace/contracts"

import type { InstanceTab } from "@/components/app-sidebar"
import { InstanceWorkspace } from "@/components/instance-workspace"
import type { AccessPermission } from "@/lib/permissions"
import { roleHasPermission } from "@/lib/permissions"
import {
  accessCapabilitiesQueryOptions,
  relaySnapshotQueryOptions,
  uiPreferencesQueryOptions,
} from "@/lib/query-options"

export const Route = createFileRoute("/_app/$serverId")({
  component: InstanceRouteLayout,
})

function InstanceRouteLayout() {
  const { serverId } = Route.useParams()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const { data: snapshot } = useQuery(relaySnapshotQueryOptions())
  const { data: capabilities } = useSuspenseQuery(
    accessCapabilitiesQueryOptions()
  )
  const { data: uiPreferences } = useSuspenseQuery(uiPreferencesQueryOptions())
  const instance = findInstance(snapshot?.instances ?? [], serverId)
  const instanceId = instance?.id

  const activeTab: InstanceTab = /\/files(?:\/|$)/.test(pathname)
    ? "files"
    : pathname.endsWith("/info")
      ? "info"
      : "console"
  const title =
    activeTab === "console"
      ? "Console"
      : activeTab === "files"
        ? "Files"
        : "Info"

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

  if (!snapshot || !instance) return null

  return (
    <InstanceWorkspace
      instance={instance}
      node={snapshot.node}
      title={title}
      fileTreePreferences={fileTreePreferences}
      permissions={permissions}
    >
      <Outlet />
    </InstanceWorkspace>
  )
}

function findInstance(
  instances: Array<RelayInstance>,
  identifier: string
): RelayInstance | undefined {
  return instances.find(
    (item) =>
      item.shortId === identifier ||
      item.id === identifier ||
      item.name === identifier
  )
}
