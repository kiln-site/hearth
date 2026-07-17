import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router"
import type { RelayInstance, RelaySnapshot } from "@workspace/contracts"

import type { InstanceTab } from "@/components/app-sidebar"
import { InstanceWorkspace } from "@/components/instance-workspace"
import type { AccessPermission } from "@/lib/permissions"
import { roleHasPermission } from "@/lib/permissions"
import {
  accessCapabilitiesQueryOptions,
  queryKeys,
  relaySnapshotQueryOptions,
  uiPreferencesQueryOptions,
} from "@/lib/query-options"

export const Route = createFileRoute("/_app/$serverId")({
  component: InstanceRouteLayout,
})

function InstanceRouteLayout() {
  const queryClient = useQueryClient()
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

  if (!snapshot || !instance) return null
  const instanceId = instance.id

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

  function updateInstance(updated: RelayInstance) {
    queryClient.setQueryData<RelaySnapshot>(
      queryKeys.relay.snapshot,
      (current) =>
        current
          ? {
              ...current,
              instances: current.instances.map((item) =>
                item.id === updated.id ? updated : item
              ),
            }
          : current
    )
  }

  function can(permission: AccessPermission): boolean {
    return (
      capabilities.isPlatformAdmin ||
      capabilities.grants.some(
        (grant) =>
          roleHasPermission(grant.role, permission) &&
          (grant.resourceType === "relay" || grant.resourceId === instanceId)
      )
    )
  }

  return (
    <InstanceWorkspace
      instance={instance}
      node={snapshot.node}
      title={title}
      fileTreePreferences={{
        collapsed: uiPreferences.fileTreeCollapsed,
        width: uiPreferences.fileTreeWidth,
      }}
      permissions={{
        consoleWrite: can("instance.console.write"),
        filesWrite: can("instance.files.write"),
        power: can("instance.power"),
        settings: can("instance.settings"),
        shareLogs: can("instance.logs.share"),
      }}
      onInstanceUpdate={updateInstance}
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
