import * as React from "react"
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useNavigate, useRouterState } from "@tanstack/react-router"

import { EmptyServerState } from "@/components/empty-server-state"
import { InstanceRouteFrame } from "@/components/instance-route-frame"
import { RelayConnectionNotice } from "@/components/relay-connection-status"
import { RelayUnavailableState } from "@/components/relay-unavailable-state"
import { SettingsLayout } from "@/components/settings-layout"
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
import type {
  RouteInstance,
  SidebarInstance,
} from "@/lib/relay-selectors"

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
    select: (state) => globalSectionFromPathname(state.location.pathname),
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
    select: (state) => globalSectionFromPathname(state.location.pathname),
  })

  if (activeSection === "settings") {
    return <SettingsLayout>{children}</SettingsLayout>
  }
  if (activeSection) return children
  return <InstanceRouteViewport>{children}</InstanceRouteViewport>
}

function InstanceRouteViewport({ children }: { children: React.ReactNode }) {
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
  if (!snapshotQuery.data) return <div className="min-h-0 flex-1 bg-background" />
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

function globalSectionFromPathname(pathname: string): GlobalSection {
  if (pathname === "/bricks") return "bricks"
  if (pathname === "/access") return "access"
  if (pathname === "/security") return "security"
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return "settings"
  }
  return null
}
