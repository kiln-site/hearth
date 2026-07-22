import * as React from "react"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"

import { InstanceWorkspace } from "@/components/instance-workspace"
import type { AccessPermission } from "@/lib/permissions"
import { roleHasPermission } from "@/lib/permissions"
import {
  accessCapabilitiesQueryOptions,
  relaySnapshotQueryOptions,
  uiPreferencesQueryOptions,
} from "@/lib/query-options"
import { selectInstanceWorkspaceInstance } from "@/lib/relay-selectors"

export const InstanceRouteFrame = React.memo(function InstanceRouteFrame({
  children,
  serverId,
}: {
  children: React.ReactNode
  serverId: string
}) {
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
  const relayId = instance?.relayId

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
          grant.relayId === relayId &&
          (grant.resourceType === "relay"
            ? grant.resourceId === relayId
            : grant.resourceId === instanceId)
      )

    return {
      consoleWrite: can("instance.console.write"),
      filesWrite: can("instance.files.write"),
      networkRead: can("instance.network.read"),
      networkWrite: can("instance.network.write"),
      power: can("instance.power"),
      settings: can("instance.settings"),
      shareLogs: can("instance.logs.share"),
    }
  }, [capabilities.grants, capabilities.isPlatformAdmin, instanceId, relayId])

  if (!instance) return null

  return (
    <InstanceWorkspace
      instance={instance}
      fileTreePreferences={fileTreePreferences}
      permissions={permissions}
    >
      {children}
    </InstanceWorkspace>
  )
})
