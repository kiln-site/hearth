import * as React from "react"
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import {
  Outlet,
  useNavigate,
  useParams,
  useRouterState,
} from "@tanstack/react-router"

import { EmptyServerState } from "@/components/empty-server-state"
import { RelayConnectionNotice } from "@/components/relay-connection-status"
import { RelayUnavailableState } from "@/components/relay-unavailable-state"
import {
  accessCapabilitiesQueryOptions,
  relayConnectionQueryOptions,
  relaySnapshotQueryOptions,
} from "@/lib/query-options"
import {
  findRelayInstance,
  selectRelayConnectionSummary,
  selectSidebarInstances,
} from "@/lib/relay-selectors"
import type { SidebarInstance } from "@/lib/relay-selectors"

type GlobalSection = "access" | "bricks" | "security" | "settings" | null

const emptyInstances: Array<SidebarInstance> = []

export function AppRouteContent() {
  const queryClient = useQueryClient()
  const connectionQuery = useSuspenseQuery({
    ...relayConnectionQueryOptions(queryClient),
    select: selectRelayConnectionSummary,
  })
  const { data: capabilities } = useSuspenseQuery(
    accessCapabilitiesQueryOptions()
  )
  const snapshotQuery = useQuery({
    ...relaySnapshotQueryOptions(),
    enabled: connectionQuery.data.status !== "unconfigured",
    select: selectSidebarInstances,
  })
  const navigate = useNavigate()
  const connection = connectionQuery.data
  const instances = snapshotQuery.data
  const onRetry = React.useCallback(async () => {
    await connectionQuery.refetch()
  }, [connectionQuery.refetch])
  const onConfigure = React.useCallback(() => {
    void navigate({ to: "/settings/relays" })
  }, [navigate])
  const activeSection = useRouterState({
    select: (state) => globalSectionFromPathname(state.location.pathname),
  })
  const serverId = useParams({
    strict: false,
    select: (params) => params.serverId,
  })
  const instance = findRelayInstance(instances ?? emptyInstances, serverId)
  const selectedRelayStatus = activeSection
    ? connection.status
    : connection.status === "unreachable"
      ? "unreachable"
      : (instance?.relayStatus ?? connection.status)
  let content: React.ReactNode
  if (activeSection) content = <Outlet />
  else if (connection.status === "unconfigured") {
    content = (
      <RelayUnavailableState
        connection={connection}
        canConfigure={capabilities.isPlatformAdmin}
        onRetry={onRetry}
        onConfigure={onConfigure}
      />
    )
  } else if (!instances && snapshotQuery.isPending) {
    content = <div className="min-h-0 flex-1 bg-background" />
  } else if (!instances && connection.status === "unreachable") {
    content = (
      <RelayUnavailableState
        connection={connection}
        canConfigure={capabilities.isPlatformAdmin}
        onRetry={onRetry}
        onConfigure={onConfigure}
      />
    )
  } else if (!instances) {
    content = <div className="min-h-0 flex-1 bg-background" />
  } else if (instance) content = <Outlet />
  else {
    content = (
      <EmptyServerState canProvision={capabilities.isPlatformAdmin} />
    )
  }

  return (
    <>
      <RelayConnectionNotice
        retry={onRetry}
        status={selectedRelayStatus}
      />
      {content}
    </>
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
