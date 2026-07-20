import * as React from "react"
import { Outlet, useParams, useRouterState } from "@tanstack/react-router"

import { EmptyServerState } from "@/components/empty-server-state"
import {
  RelayConnectionNotice,
  RelayConnectionProvider,
} from "@/components/relay-connection-status"
import { RelayUnavailableState } from "@/components/relay-unavailable-state"
import { findRelayInstance } from "@/lib/relay-selectors"
import type {
  RelayConnectionSummary,
  SidebarInstance,
} from "@/lib/relay-selectors"

type GlobalSection = "access" | "bricks" | "security" | "settings" | null

const emptyInstances: Array<SidebarInstance> = []

export function AppRouteContent({
  canConfigure,
  connection,
  instances,
  loadingInstances,
  onConfigure,
  onRetry,
}: {
  canConfigure: boolean
  connection: RelayConnectionSummary
  instances: Array<SidebarInstance> | undefined
  loadingInstances: boolean
  onConfigure: () => void
  onRetry: () => Promise<void>
}) {
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
  const relayConnectionValue = React.useMemo(
    () => ({ retry: onRetry, status: selectedRelayStatus }),
    [onRetry, selectedRelayStatus]
  )

  let content: React.ReactNode
  if (activeSection) content = <Outlet />
  else if (connection.status === "unconfigured") {
    content = (
      <RelayUnavailableState
        connection={connection}
        canConfigure={canConfigure}
        onRetry={onRetry}
        onConfigure={onConfigure}
      />
    )
  } else if (!instances && loadingInstances) {
    content = <div className="min-h-0 flex-1 bg-background" />
  } else if (!instances && connection.status === "unreachable") {
    content = (
      <RelayUnavailableState
        connection={connection}
        canConfigure={canConfigure}
        onRetry={onRetry}
        onConfigure={onConfigure}
      />
    )
  } else if (!instances) {
    content = <div className="min-h-0 flex-1 bg-background" />
  } else if (instance) content = <Outlet />
  else content = <EmptyServerState canProvision={canConfigure} />

  return (
    <RelayConnectionProvider value={relayConnectionValue}>
      <RelayConnectionNotice />
      {content}
    </RelayConnectionProvider>
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
