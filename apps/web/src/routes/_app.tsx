import * as React from "react"
import {
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useParams,
  useRouterState,
} from "@tanstack/react-router"
import type { RelayInstance, RelaySnapshot } from "@workspace/contracts"
import { Cable, CircleAlert, RefreshCw, Settings } from "lucide-react"
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@workspace/ui/components/sidebar"
import { Button } from "@workspace/ui/components/button"

import { AppSidebar } from "@/components/app-sidebar"
import type { GlobalSection, InstanceTab } from "@/components/app-sidebar"
import { InstanceWorkspace } from "@/components/instance-workspace"
import { PanelFooter } from "@/components/panel-footer"
import { getRelayConnectionState } from "@/server/relay"
import { getAuthState } from "@/server/auth"
import { getAccessCapabilities } from "@/server/access"
import { getUiPreferences } from "@/server/preferences"
import type { AccessPermission } from "@/lib/permissions"
import { roleHasPermission } from "@/lib/permissions"

const tabRoutes = {
  console: "/$serverId/console",
  files: "/$serverId/files",
  info: "/$serverId/info",
} as const

const selectedInstanceStorageKey = "kiln:selected-instance-id"
type RelayConnection = Awaited<ReturnType<typeof getRelayConnectionState>>

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
  loader: async () => {
    const [connection, capabilities, uiPreferences] = await Promise.all([
      getRelayConnectionState(),
      getAccessCapabilities(),
      getUiPreferences(),
    ])
    return { capabilities, connection, uiPreferences }
  },
  component: AppLayout,
})

function AppLayout() {
  const {
    capabilities,
    connection: initialConnection,
    uiPreferences,
  } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const navigate = useNavigate()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const { serverId, _splat: filePath } = useParams({ strict: false })
  const [connection, setConnection] =
    React.useState<RelayConnection>(initialConnection)
  const [snapshot, setSnapshot] = React.useState<RelaySnapshot | null>(
    initialConnection.status === "connected" ? initialConnection.snapshot : null
  )
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
  const previousTabWasFiles = React.useRef(activeTab === "files")
  const openFileTreeOnEntry =
    activeTab === "files" && !previousTabWasFiles.current

  React.useLayoutEffect(() => {
    previousTabWasFiles.current = activeTab === "files"
  }, [activeTab])

  const refreshConnection = React.useCallback(async () => {
    const next = await getRelayConnectionState()
    setConnection(next)
    if (next.status === "connected") setSnapshot(next.snapshot)
  }, [])

  React.useEffect(() => {
    const lifecycle = new AbortController()
    let timer: number | null = null
    let polling = false
    let pollDelay = initialConnection.status === "connected" ? 2_000 : 10_000

    function commitConnection(next: RelayConnection) {
      if (lifecycle.signal.aborted) return
      pollDelay = next.status === "connected" ? 2_000 : 10_000
      setConnection(next)
      if (next.status === "connected") setSnapshot(next.snapshot)
    }

    function scheduleNextPoll() {
      if (lifecycle.signal.aborted) return
      timer = window.setTimeout(() => void poll(), pollDelay)
    }

    async function poll() {
      if (lifecycle.signal.aborted || polling) return
      polling = true
      try {
        commitConnection(await getRelayConnectionState())
      } catch {
        // A transport failure to Hearth itself is retried on the next tick.
      } finally {
        polling = false
        scheduleNextPoll()
      }
    }

    function resumePolling() {
      if (document.visibilityState !== "visible") return
      if (timer !== null) window.clearTimeout(timer)
      timer = null
      void poll()
    }

    timer = window.setTimeout(() => void poll(), pollDelay)
    document.addEventListener("visibilitychange", resumePolling)
    return () => {
      lifecycle.abort()
      if (timer !== null) window.clearTimeout(timer)
      document.removeEventListener("visibilitychange", resumePolling)
    }
  }, [])

  const instances = snapshot?.instances ?? []
  const routeInstance = findInstance(instances, serverId)
  const rememberedInstance = findInstance(instances, selectedInstanceId)
  const instance: RelayInstance | undefined =
    routeInstance ?? rememberedInstance ?? instances.at(0)

  const rememberInstance = React.useCallback((next: RelayInstance) => {
    setSelectedInstanceId(next.id)
    window.localStorage.setItem(selectedInstanceStorageKey, next.id)
  }, [])

  React.useEffect(() => {
    if (serverId) return

    const storedInstance = findInstance(
      instances,
      window.localStorage.getItem(selectedInstanceStorageKey)
    )
    if (storedInstance) setSelectedInstanceId(storedInstance.id)
  }, [serverId, snapshot?.instances])

  React.useEffect(() => {
    if (routeInstance) rememberInstance(routeInstance)
  }, [rememberInstance, routeInstance?.id])

  React.useEffect(() => {
    if (!activeTab || !instance || instance.shortId === serverId) return
    void navigate({
      to: tabRoutes[activeTab],
      params: { serverId: instance.shortId },
      replace: true,
    })
  }, [activeTab, instance, navigate, serverId])

  function updateInstance(updated: RelayInstance) {
    setSnapshot((current) =>
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
          (grant.resourceType === "relay" || grant.resourceId === instance?.id)
      )
    )
  }

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
          const nextInstance = findInstance(instances, shortId)
          if (nextInstance) rememberInstance(nextInstance)
          void navigate({
            to: tabRoutes[activeTab ?? "console"],
            params: { serverId: shortId },
          })
        }}
        onTabChange={(tab) => {
          if (!instance) return
          void navigate({
            to: tabRoutes[tab],
            params: { serverId: instance.shortId },
          })
        }}
      />
      <SidebarInset className="h-svh min-w-0 overflow-hidden">
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
              onRetry={() => void refreshConnection()}
              onConfigure={() => void navigate({ to: "/settings" })}
            />
          ) : !snapshot ? (
            <div className="min-h-0 flex-1 bg-background" />
          ) : instance && activeTab ? (
            <>
              <InstanceWorkspace
                instance={instance}
                node={snapshot.node}
                activeTab={activeTab}
                filePath={activeTab === "files" ? filePath : undefined}
                openFileTreeOnEntry={openFileTreeOnEntry}
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
              />
              <Outlet />
            </>
          ) : (
            <EmptyServerState canProvision={capabilities.isPlatformAdmin} />
          )}
        </div>
        <PanelFooter />
      </SidebarInset>
    </SidebarProvider>
  )
}

function findInstance(
  instances: Array<RelayInstance>,
  identifier: string | null | undefined
): RelayInstance | undefined {
  if (!identifier) return undefined
  return instances.find(
    (item) =>
      item.shortId === identifier ||
      item.id === identifier ||
      item.name === identifier
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
  connection: Exclude<RelayConnection, { status: "connected" }>
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
