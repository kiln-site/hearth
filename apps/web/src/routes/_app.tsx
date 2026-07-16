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
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@workspace/ui/components/sidebar"

import { AppSidebar } from "@/components/app-sidebar"
import type { GlobalSection, InstanceTab } from "@/components/app-sidebar"
import { InstanceWorkspace } from "@/components/instance-workspace"
import { PanelFooter } from "@/components/panel-footer"
import { getRelaySnapshot } from "@/server/relay"
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
    const [snapshot, capabilities, uiPreferences] = await Promise.all([
      getRelaySnapshot(),
      getAccessCapabilities(),
      getUiPreferences(),
    ])
    return { capabilities, snapshot, uiPreferences }
  },
  component: AppLayout,
})

function AppLayout() {
  const {
    capabilities,
    snapshot: initialSnapshot,
    uiPreferences,
  } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const navigate = useNavigate()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const { serverId, _splat: filePath } = useParams({ strict: false })
  const [snapshot, setSnapshot] = React.useState<RelaySnapshot>(initialSnapshot)
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

  React.useEffect(() => {
    const lifecycle = new AbortController()
    let timer: number | null = null
    let polling = false

    function commitSnapshot(next: RelaySnapshot) {
      if (lifecycle.signal.aborted) return
      setSnapshot(next)
    }

    function scheduleNextPoll() {
      if (lifecycle.signal.aborted) return
      timer = window.setTimeout(() => void poll(), 2_000)
    }

    async function poll() {
      if (lifecycle.signal.aborted || polling) return
      polling = true
      try {
        commitSnapshot(await getRelaySnapshot())
      } catch {
        // Keep the last healthy snapshot and retry on the next tick.
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

    timer = window.setTimeout(() => void poll(), 2_000)
    document.addEventListener("visibilitychange", resumePolling)
    return () => {
      lifecycle.abort()
      if (timer !== null) window.clearTimeout(timer)
      document.removeEventListener("visibilitychange", resumePolling)
    }
  }, [])

  const routeInstance = findInstance(snapshot.instances, serverId)
  const rememberedInstance = findInstance(
    snapshot.instances,
    selectedInstanceId
  )
  const instance: RelayInstance | undefined =
    routeInstance ?? rememberedInstance ?? snapshot.instances.at(0)

  const rememberInstance = React.useCallback((next: RelayInstance) => {
    setSelectedInstanceId(next.id)
    window.localStorage.setItem(selectedInstanceStorageKey, next.id)
  }, [])

  React.useEffect(() => {
    if (serverId) return

    const storedInstance = findInstance(
      snapshot.instances,
      window.localStorage.getItem(selectedInstanceStorageKey)
    )
    if (storedInstance) setSelectedInstanceId(storedInstance.id)
  }, [serverId, snapshot.instances])

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
    setSnapshot((current) => ({
      ...current,
      instances: current.instances.map((item) =>
        item.id === updated.id ? updated : item
      ),
    }))
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
        instances={snapshot.instances}
        instance={instance}
        user={user}
        activeTab={activeTab}
        activeSection={activeSection}
        canManageAccess={capabilities.canManageAccess}
        isPlatformAdmin={capabilities.isPlatformAdmin}
        onInstanceChange={(shortId) => {
          const nextInstance = findInstance(snapshot.instances, shortId)
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
            <EmptyServerState />
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

function EmptyServerState() {
  return (
    <div className="grid min-h-0 flex-1 place-items-center bg-background px-6 text-center">
      <div className="max-w-sm border border-border/70 bg-card/35 p-6">
        <p className="font-heading text-xl font-semibold">No managed servers</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Open Bricks to provision an instance, or configure a Relay connection
          from Settings.
        </p>
      </div>
    </div>
  )
}
