import * as React from "react"
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import {
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useParams,
  useRouterState,
} from "@tanstack/react-router"
import { Cable, CircleAlert, RefreshCw, Settings } from "lucide-react"
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@workspace/ui/components/sidebar"
import { Button } from "@workspace/ui/components/button"

import { AppSidebar } from "@/components/app-sidebar"
import type { GlobalSection, InstanceTab } from "@/components/app-sidebar"
import { PanelFooter } from "@/components/panel-footer"
import { getAuthState } from "@/server/auth"
import {
  accessCapabilitiesQueryOptions,
  relayConnectionQueryOptions,
  relaySnapshotQueryOptions,
  uiPreferencesQueryOptions,
} from "@/lib/query-options"
import {
  findRelayInstance,
  selectRelayConnectionSummary,
  selectSidebarInstances,
} from "@/lib/relay-selectors"
import type {
  RelayConnectionSummary,
  SidebarInstance,
} from "@/lib/relay-selectors"

const tabRoutes = {
  console: "/$serverId/console",
  info: "/$serverId/info",
} as const

const selectedInstanceStorageKey = "kiln:selected-instance-id"
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
  const { data: sidebarInstances } = useQuery({
    ...relaySnapshotQueryOptions(),
    enabled: connectionQuery.data.status === "connected",
    select: selectSidebarInstances,
  })
  const connection = connectionQuery.data
  const { user } = Route.useRouteContext()
  const navigate = useNavigate()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const { serverId } = useParams({ strict: false })
  const [selectedInstanceId, setSelectedInstanceId] = React.useState<
    string | null
  >(null)
  const activeSection: GlobalSection =
    pathname === "/bricks"
      ? "bricks"
      : pathname === "/settings"
        ? "settings"
        : pathname === "/access"
          ? "access"
          : pathname === "/security"
            ? "security"
            : null
  const activeTab: InstanceTab | null = activeSection
    ? null
    : /\/files(?:\/|$)/.test(pathname)
      ? "files"
      : pathname.endsWith("/info")
        ? "info"
        : "console"
  const instances = sidebarInstances ?? emptyInstances
  const routeInstance = findRelayInstance(instances, serverId)
  const rememberedInstance = findRelayInstance(instances, selectedInstanceId)
  const instance: SidebarInstance | undefined =
    routeInstance ?? rememberedInstance ?? instances.at(0)

  const rememberInstance = React.useCallback((instanceId: string) => {
    setSelectedInstanceId(instanceId)
    window.localStorage.setItem(selectedInstanceStorageKey, instanceId)
  }, [])
  const navigateToInstanceTab = React.useCallback(
    (tab: InstanceTab, nextServerId: string, replace = false) => {
      if (tab === "files") {
        return navigate({
          to: "/$serverId/files/$",
          params: { serverId: nextServerId, _splat: "" },
          replace,
        })
      }
      if (tab === "info") {
        return navigate({
          to: tabRoutes.info,
          params: { serverId: nextServerId },
          replace,
        })
      }
      return navigate({
        to: tabRoutes.console,
        params: { serverId: nextServerId },
        replace,
      })
    },
    [navigate]
  )

  React.useEffect(() => {
    if (serverId) return

    const storedInstance = findRelayInstance(
      instances,
      window.localStorage.getItem(selectedInstanceStorageKey)
    )
    if (storedInstance) setSelectedInstanceId(storedInstance.id)
  }, [instances, serverId])

  React.useEffect(() => {
    if (routeInstance?.id) rememberInstance(routeInstance.id)
  }, [rememberInstance, routeInstance?.id])

  React.useEffect(() => {
    if (!activeTab || !instance || instance.shortId === serverId) return
    void navigateToInstanceTab(activeTab, instance.shortId, true)
  }, [activeTab, instance, navigateToInstanceTab, serverId])

  return (
    <SidebarProvider defaultOpen={uiPreferences.sidebarOpen}>
      <MobileSidebarNavigationDismiss pathname={pathname} />
      <AppSidebar
        instances={instances}
        instance={instance}
        user={user}
        activeTab={activeTab}
        activeSection={activeSection}
        canManageAccess={
          connection.status === "connected" && capabilities.canManageAccess
        }
        isPlatformAdmin={capabilities.isPlatformAdmin}
        relayStatus={connection.status}
        relayName={connection.relay?.name}
        onInstanceChange={(shortId) => {
          const nextInstance = findRelayInstance(instances, shortId)
          if (nextInstance) rememberInstance(nextInstance.id)
          void navigateToInstanceTab(activeTab ?? "console", shortId)
        }}
        onTabChange={(tab) => {
          if (!instance) return
          void navigateToInstanceTab(tab, instance.shortId)
        }}
      />
      <SidebarInset className="h-dvh min-w-0 overflow-hidden">
        <div
          data-slot="app-content"
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {activeSection ? (
            <Outlet />
          ) : connection.status !== "connected" ? (
            <RelayUnavailableState
              connection={connection}
              canConfigure={capabilities.isPlatformAdmin}
              onRetry={() => void connectionQuery.refetch()}
              onConfigure={() => void navigate({ to: "/settings" })}
            />
          ) : !sidebarInstances ? (
            <div className="min-h-0 flex-1 bg-background" />
          ) : instance && activeTab ? (
            <Outlet />
          ) : (
            <EmptyServerState canProvision={capabilities.isPlatformAdmin} />
          )}
        </div>
        <PanelFooter />
      </SidebarInset>
    </SidebarProvider>
  )
}

function MobileSidebarNavigationDismiss({ pathname }: { pathname: string }) {
  const { isMobile, setOpenMobile } = useSidebar()

  React.useEffect(() => {
    if (isMobile) setOpenMobile(false)
  }, [isMobile, pathname, setOpenMobile])

  return null
}

function EmptyServerState({ canProvision }: { canProvision: boolean }) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center bg-background px-6 text-center">
      <div className="max-w-sm border border-border/70 bg-card/35 p-6">
        <p className="font-heading text-xl font-semibold">No managed servers</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {canProvision
            ? "Open Bricks to provision an instance, or configure a Relay connection from Settings."
            : "No server instances have been assigned to your account yet."}
        </p>
      </div>
    </div>
  )
}

function RelayUnavailableState({
  connection,
  canConfigure,
  onRetry,
  onConfigure,
}: {
  connection: Exclude<RelayConnectionSummary, { status: "connected" }>
  canConfigure: boolean
  onRetry: () => void
  onConfigure: () => void
}) {
  const configured = connection.status === "unreachable"
  return (
    <main className="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-background px-5 py-10">
      <div
        className="pointer-events-none absolute inset-0 opacity-35"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage:
            "radial-gradient(circle at center, black 0%, transparent 72%)",
        }}
      />
      <section className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border/80 bg-card/80 shadow-2xl shadow-black/15 backdrop-blur-sm">
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-3">
          <span className="flex items-center gap-2 font-mono text-[9px] tracking-[0.18em] text-muted-foreground uppercase">
            <span className="size-1.5 rounded-full bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.65)]" />
            Control plane status
          </span>
          <span className="font-mono text-[9px] text-amber-400 uppercase">
            {configured ? "Disconnected" : "Setup required"}
          </span>
        </div>
        <div className="p-6 sm:p-8">
          <div className="grid size-12 place-items-center rounded-xl border border-amber-400/25 bg-amber-400/8 text-amber-300">
            {configured ? (
              <CircleAlert className="size-5" />
            ) : (
              <Cable className="size-5" />
            )}
          </div>
          <p className="mt-6 font-mono text-[10px] tracking-[0.16em] text-primary uppercase">
            {configured ? connection.relay.name : "Relay enrollment"}
          </p>
          <h1 className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">
            {configured
              ? "Hearth is waiting for its Relay"
              : "Connect your first Relay"}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
            {configured
              ? "The dashboard is available, but live server controls are paused until the Relay can be reached. Your Relay and game servers continue independently."
              : "Hearth is ready. Add a Relay endpoint to discover and operate the game servers on another node."}
          </p>
          <div className="mt-7 flex flex-col gap-2 sm:flex-row">
            {canConfigure ? (
              <Button onClick={onConfigure}>
                <Settings /> {configured ? "Review Relay" : "Configure Relay"}
              </Button>
            ) : null}
            <Button variant="outline" onClick={onRetry}>
              <RefreshCw /> Check again
            </Button>
          </div>
        </div>
        <div className="border-t border-border/70 bg-muted/10 px-5 py-3 font-mono text-[9px] leading-4 text-muted-foreground">
          Hearth checks the active Relay automatically. No page reload is
          required.
        </div>
      </section>
    </main>
  )
}
