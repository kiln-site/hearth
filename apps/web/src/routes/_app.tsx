import * as React from "react"
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import {
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router"
import { useSidebar } from "@workspace/ui/components/sidebar"

import { AppFrame } from "@/components/app-frame"
import { AppRouteContent } from "@/components/app-route-content"
import { AppSidebar } from "@/components/app-sidebar"
import { getAuthState } from "@/server/auth"
import {
  accessCapabilitiesQueryOptions,
  relayConnectionQueryOptions,
  relaySnapshotQueryOptions,
  uiPreferencesQueryOptions,
} from "@/lib/query-options"
import {
  selectRelayConnectionSummary,
  selectSidebarInstances,
} from "@/lib/relay-selectors"
import type { SidebarInstance } from "@/lib/relay-selectors"

const emptyInstances: Array<SidebarInstance> = []

export const Route = createFileRoute("/_app")({
  staleTime: Infinity,
  beforeLoad: async ({ location }) => {
    const { user } = await getAuthState()
    if (!user) {
      throw redirect({
        to: "/",
        search: { redirect: location.href },
      })
    }
    return { user }
  },
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(
        relayConnectionQueryOptions(context.queryClient)
      ),
      context.queryClient.ensureQueryData(accessCapabilitiesQueryOptions()),
      context.queryClient.ensureQueryData(uiPreferencesQueryOptions()),
    ])
  },
  component: AppLayout,
})

function AppLayout() {
  const queryClient = useQueryClient()
  const connectionQuery = useSuspenseQuery({
    ...relayConnectionQueryOptions(queryClient),
    select: selectRelayConnectionSummary,
  })
  const { data: capabilities } = useSuspenseQuery(
    accessCapabilitiesQueryOptions()
  )
  const { data: uiPreferences } = useSuspenseQuery(uiPreferencesQueryOptions())
  const snapshotQuery = useQuery({
    ...relaySnapshotQueryOptions(),
    enabled: connectionQuery.data.status !== "unconfigured",
    select: selectSidebarInstances,
  })
  const sidebarInstances = snapshotQuery.data
  const connection = connectionQuery.data
  const navigate = useNavigate()
  const instances = sidebarInstances ?? emptyInstances
  const handleRetry = React.useCallback(async () => {
    await connectionQuery.refetch()
  }, [connectionQuery.refetch])
  const handleConfigure = React.useCallback(() => {
    void navigate({ to: "/settings" })
  }, [navigate])
  const sidebarProps = React.useMemo<React.ComponentProps<typeof AppSidebar>>(
    () => ({
      canManageAccess: capabilities.canManageAccess,
      instances,
      isPlatformAdmin: capabilities.isPlatformAdmin,
      relayName: connection.relay?.name,
      relayCount: connection.relays?.length ?? (connection.relay ? 1 : 0),
      relayStatus: connection.status,
      user: capabilities.user,
    }),
    [
      capabilities.canManageAccess,
      capabilities.isPlatformAdmin,
      connection.relay,
      connection.relays?.length,
      connection.status,
      instances,
      capabilities.user,
    ]
  )
  const navigationDismiss = React.useMemo(
    () => <MobileSidebarNavigationDismiss />,
    []
  )

  return (
    <AppFrame
      navigationDismiss={navigationDismiss}
      sidebar={<AppSidebar {...sidebarProps} />}
      sidebarDefaultOpen={uiPreferences.sidebarOpen}
    >
      <AppRouteContent
        canConfigure={capabilities.isPlatformAdmin}
        connection={connection}
        instances={sidebarInstances}
        loadingInstances={snapshotQuery.isPending}
        onConfigure={handleConfigure}
        onRetry={handleRetry}
      />
    </AppFrame>
  )
}

function MobileSidebarNavigationDismiss() {
  const { isMobile, setOpenMobile } = useSidebar()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  React.useEffect(() => {
    if (isMobile) setOpenMobile(false)
  }, [isMobile, pathname, setOpenMobile])

  return null
}
