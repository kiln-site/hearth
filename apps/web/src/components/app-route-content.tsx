import * as React from "react"
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useNavigate, useRouterState } from "@tanstack/react-router"

import { EmptyServerState } from "@/components/empty-server-state"
import { InstanceRouteFrame } from "@/components/instance-route-frame"
import { InstanceWorkspaceShell } from "@/components/instance-workspace"
import { RelayConnectionNotice } from "@/components/relay-connection-status"
import { RelayUnavailableState } from "@/components/relay-unavailable-state"
import { SettingsShell } from "@/components/settings-layout"
import { GlobalPageToolbar } from "@/components/global-page-toolbar"
import { WorkspaceFrame } from "@/components/workspace-frame"
import {
  accessCapabilitiesQueryOptions,
  relayConnectionQueryOptions,
  relaySnapshotQueryOptions,
} from "@/lib/query-options"
import {
  findRelayInstance,
  selectRelayConnectionSummary,
  selectRouteInstances,
  selectSidebarInstances,
} from "@/lib/relay-selectors"
import type { RouteInstance, SidebarInstance } from "@/lib/relay-selectors"

type GlobalSection = "access" | "bricks" | "security" | "settings" | null

const emptyInstances: Array<SidebarInstance> = []
const emptyRouteInstances: Array<RouteInstance> = []

export function AppRouteContent({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RelayConnectionNoticeBoundary />
      <AppRouteViewport>{children}</AppRouteViewport>
    </>
  )
}

function RelayConnectionNoticeBoundary() {
  const queryClient = useQueryClient()
  const connectionQuery = useSuspenseQuery({
    ...relayConnectionQueryOptions(queryClient),
    select: selectRelayConnectionSummary,
  })
  const connection = connectionQuery.data
  const { data: instances = emptyRouteInstances } = useQuery({
    ...relaySnapshotQueryOptions(),
    enabled: connection.status !== "unconfigured",
    select: selectRouteInstances,
  })
  const activeSection = useRouterState({
    select: (state) => globalSectionFromRouteId(state.matches.at(-1)?.routeId),
  })
  const serverId = useRouterState({
    select: (state) =>
      (state.matches.at(-1)?.params as { serverId?: string } | undefined)
        ?.serverId,
  })
  const instance = findRelayInstance(instances, serverId)
  const status = activeSection
    ? connection.status
    : connection.status === "unreachable"
      ? "unreachable"
      : (instance?.relayStatus ?? connection.status)
  const retry = React.useCallback(async () => {
    await connectionQuery.refetch()
  }, [connectionQuery.refetch])
  return <RelayConnectionNotice retry={retry} status={status} />
}

function AppRouteViewport({ children }: { children: React.ReactNode }) {
  const activeSection = useRouterState({
    select: (state) => globalSectionFromRouteId(state.matches.at(-1)?.routeId),
  })

  if (activeSection) {
    return (
      <GlobalRouteFrame section={activeSection}>{children}</GlobalRouteFrame>
    )
  }
  return <InstanceRouteViewport>{children}</InstanceRouteViewport>
}

const GlobalRouteFrame = React.memo(function GlobalRouteFrame({
  children,
  section,
}: {
  children: React.ReactNode
  section: Exclude<GlobalSection, null>
}) {
  return (
    <WorkspaceFrame header={<GlobalPageToolbar label={routeLabel(section)} />}>
      <div
        data-slot="global-route-content"
        className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background/55"
      >
        {section === "settings" ? (
          <SettingsShell>{children}</SettingsShell>
        ) : (
          children
        )}
      </div>
    </WorkspaceFrame>
  )
})

const InstanceRouteViewport = React.memo(function InstanceRouteViewport({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <InstanceWorkspaceShell>
      <InstanceRouteBoundary>{children}</InstanceRouteBoundary>
    </InstanceWorkspaceShell>
  )
})

function InstanceRouteBoundary({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const { data: configured } = useSuspenseQuery({
    ...relayConnectionQueryOptions(queryClient),
    select: (connection) => connection.status !== "unconfigured",
  })
  const snapshotQuery = useQuery({
    ...relaySnapshotQueryOptions(),
    enabled: configured,
    select: selectSidebarInstances,
  })
  const serverId = useRouterState({
    select: (state) =>
      (state.matches.at(-1)?.params as { serverId?: string } | undefined)
        ?.serverId,
  })

  if (!configured) return <RouteEmptyState />
  if (!snapshotQuery.data)
    return <div className="min-h-0 flex-1 bg-background" />
  if (
    serverId &&
    findRelayInstance(snapshotQuery.data ?? emptyInstances, serverId)
  ) {
    return (
      <InstanceRouteFrame serverId={serverId}>{children}</InstanceRouteFrame>
    )
  }
  return <RouteEmptyState />
}

function RouteEmptyState() {
  const queryClient = useQueryClient()
  const connectionQuery = useSuspenseQuery({
    ...relayConnectionQueryOptions(queryClient),
    select: selectRelayConnectionSummary,
  })
  const { data: capabilities } = useSuspenseQuery(
    accessCapabilitiesQueryOptions()
  )
  const navigate = useNavigate()
  const retry = React.useCallback(async () => {
    await connectionQuery.refetch()
  }, [connectionQuery.refetch])
  const configure = React.useCallback(() => {
    void navigate({ to: "/settings/relays" })
  }, [navigate])

  return connectionQuery.data.status === "connected" ? (
    <EmptyServerState canProvision={capabilities.isPlatformAdmin} />
  ) : (
    <RelayUnavailableState
      connection={connectionQuery.data}
      canConfigure={capabilities.isPlatformAdmin}
      onRetry={retry}
      onConfigure={configure}
    />
  )
}

function globalSectionFromRouteId(routeId: string | undefined): GlobalSection {
  if (routeId === "/_app/bricks") return "bricks"
  if (routeId === "/_app/access") return "access"
  if (routeId === "/_app/security") return "security"
  if (routeId?.startsWith("/_app/settings")) {
    return "settings"
  }
  return null
}

function routeLabel(section: Exclude<GlobalSection, null>) {
  if (section === "bricks") return "Infrastructure / Bricks"
  if (section === "access") return "Administration / Access"
  if (section === "security") return "Account / Security"
  return "Application / Settings"
}
