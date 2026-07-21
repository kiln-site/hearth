import * as React from "react"
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import {
  Boxes,
  ChevronsUpDown,
  CircleHelp,
  Folder,
  ListTodo,
  LoaderCircle,
  LogOut,
  Settings,
  SlidersHorizontal,
  TerminalSquare,
  UserRoundCog,
} from "lucide-react"
import { useMatch, useNavigate, useRouterState } from "@tanstack/react-router"

import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@workspace/ui/components/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import { HearthMark } from "@/components/hearth-mark"
import { ServerTypeIcon } from "@/components/server-type-icon"
import { authClient } from "@/lib/auth-client"
import type { AuthenticatedUser } from "@/lib/auth-session"
import {
  accessCapabilitiesQueryOptions,
  relayConnectionQueryOptions,
  relaySnapshotQueryOptions,
} from "@/lib/query-options"
import { disableDevelopmentBypass } from "@/server/auth"
import { findRelayInstance } from "@/lib/relay-selectors"
import {
  selectRelayConfigured,
  selectSidebarInstances,
} from "@/lib/relay-selectors"
import type { SidebarInstance } from "@/lib/relay-selectors"

export type InstanceTab = "console" | "files" | "info"
export type GlobalSection = "access" | "bricks" | "security" | "settings" | null

const instanceItems: Array<{
  title: string
  value: InstanceTab
  icon: typeof TerminalSquare
}> = [
  { title: "Console", value: "console", icon: TerminalSquare },
  { title: "Files", value: "files", icon: Folder },
  { title: "Info", value: "info", icon: SlidersHorizontal },
]

const selectedInstanceStorageKey = "kiln:selected-instance-id"

function subscribeToSelectedInstanceStorage(listener: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === selectedInstanceStorageKey) listener()
  }
  window.addEventListener("storage", handleStorage)
  return () => window.removeEventListener("storage", handleStorage)
}

function selectedInstanceStorageSnapshot() {
  return window.localStorage.getItem(selectedInstanceStorageKey)
}

function selectedInstanceServerSnapshot() {
  return null
}

interface AppSidebarViewProps {
  instances: Array<SidebarInstance>
  user: AuthenticatedUser
  canManageAccess: boolean
  isPlatformAdmin: boolean
}

const emptyInstances: Array<SidebarInstance> = []

export function AppSidebar() {
  const queryClient = useQueryClient()
  const { data: relayConfigured } = useSuspenseQuery({
    ...relayConnectionQueryOptions(queryClient),
    select: selectRelayConfigured,
  })
  const { data: capabilities } = useSuspenseQuery(
    accessCapabilitiesQueryOptions()
  )
  const { data: instances = emptyInstances } = useQuery({
    ...relaySnapshotQueryOptions(),
    enabled: relayConfigured,
    select: selectSidebarInstances,
  })

  return (
    <AppSidebarView
      canManageAccess={capabilities.canManageAccess}
      instances={instances}
      isPlatformAdmin={capabilities.isPlatformAdmin}
      user={capabilities.user}
    />
  )
}

const AppSidebarView = React.memo(function AppSidebarView({
  instances,
  user,
  canManageAccess,
  isPlatformAdmin,
}: AppSidebarViewProps) {
  return (
    <Sidebar collapsible="icon" className="border-sidebar-border/80">
      <SidebarHeader className="gap-1 px-2 pt-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="h-11 data-[state=open]:bg-sidebar-accent"
              tooltip="Kiln"
            >
              <HearthMark />
              <span className="min-w-0 flex-1 truncate font-heading text-[15px] font-semibold tracking-[-0.02em]">
                Kiln
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <InfrastructureNavigation
          instances={instances}
          isPlatformAdmin={isPlatformAdmin}
        />

        {instances.length > 0 ? <SidebarSeparator /> : null}

        {instances.length > 0 ? (
          <SelectedInstanceNavigation instances={instances} />
        ) : null}
      </SidebarContent>

      <AccountNavigation
        canManageAccess={canManageAccess}
        isPlatformAdmin={isPlatformAdmin}
        user={user}
      />
    </Sidebar>
  )
})

function InfrastructureNavigation({
  instances,
  isPlatformAdmin,
}: {
  instances: Array<SidebarInstance>
  isPlatformAdmin: boolean
}) {
  return (
    <SidebarGroup className="pt-2">
      <SidebarGroupLabel className="text-[10px] tracking-[0.12em] uppercase">
        Infrastructure
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <BricksNavigationItem
            instanceCount={instances.length}
            isPlatformAdmin={isPlatformAdmin}
          />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function BricksNavigationItem({
  instanceCount,
  isPlatformAdmin,
}: {
  instanceCount: number
  isPlatformAdmin: boolean
}) {
  const navigate = useNavigate()
  const isActive = useRouterState({
    select: (state) => state.location.pathname === "/bricks",
  })
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={
          isPlatformAdmin
            ? "Bricks"
            : "Brick provisioning is administrator-only"
        }
        type="button"
        isActive={isActive}
        aria-disabled={!isPlatformAdmin}
        tabIndex={isPlatformAdmin ? 0 : -1}
        className={
          isPlatformAdmin
            ? "data-active:bg-primary/10 data-active:text-primary"
            : "text-sidebar-foreground/35 aria-disabled:pointer-events-auto! aria-disabled:cursor-not-allowed aria-disabled:opacity-100"
        }
        onClick={() => {
          if (isPlatformAdmin) void navigate({ to: "/bricks" })
        }}
      >
        <Boxes />
        <span>Bricks</span>
      </SidebarMenuButton>
      <SidebarMenuBadge className="text-sidebar-foreground/25">
        {instanceCount}
      </SidebarMenuBadge>
    </SidebarMenuItem>
  )
}

function SelectedInstanceNavigation({
  instances,
}: {
  instances: Array<SidebarInstance>
}) {
  const serverId = useRouterState({
    select: (state) =>
      (state.matches.at(-1)?.params as { serverId?: string } | undefined)
        ?.serverId,
  })
  const selectedInstanceId = React.useSyncExternalStore(
    subscribeToSelectedInstanceStorage,
    selectedInstanceStorageSnapshot,
    selectedInstanceServerSnapshot
  )
  const routeInstance = findRelayInstance(instances, serverId)
  const rememberedInstance = findRelayInstance(instances, selectedInstanceId)
  const instance = routeInstance ?? rememberedInstance ?? instances.at(0)

  const rememberInstance = React.useCallback((instanceId: string) => {
    window.localStorage.setItem(selectedInstanceStorageKey, instanceId)
  }, [])

  React.useEffect(() => {
    if (routeInstance?.routeId) rememberInstance(routeInstance.routeId)
  }, [rememberInstance, routeInstance?.routeId])

  return instance ? (
    <InstanceNavigation
      instance={instance}
      instances={instances}
      onRememberInstance={rememberInstance}
    />
  ) : null
}

const InstanceNavigation = React.memo(function InstanceNavigation({
  instance,
  instances,
  onRememberInstance,
}: {
  instance: SidebarInstance
  instances: Array<SidebarInstance>
  onRememberInstance: (id: string) => void
}) {
  const navigate = useNavigate()
  const selectedInstanceRouteId = React.useRef(instance.routeId)

  const navigateToTab = React.useCallback(
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
          to: "/$serverId/info",
          params: { serverId: nextServerId },
          replace,
        })
      }
      return navigate({
        to: "/$serverId/console",
        params: { serverId: nextServerId },
        replace,
      })
    },
    [navigate]
  )
  const navigateToSelectedTab = React.useCallback(
    (tab: InstanceTab) => {
      void navigateToTab(tab, selectedInstanceRouteId.current)
    },
    [navigateToTab]
  )

  React.useEffect(() => {
    selectedInstanceRouteId.current = instance.routeId
  }, [instance.routeId])

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-[10px] tracking-[0.12em] uppercase">
        Selected server
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <ServerSelector
            instance={instance}
            instances={instances}
            navigateToTab={navigateToTab}
            onRememberInstance={onRememberInstance}
          />
          <CanonicalInstanceRoute instanceRouteId={instance.routeId} />
          <InstanceTabNavigation navigateToTab={navigateToSelectedTab} />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
})

const ServerSelector = React.memo(function ServerSelector({
  instance,
  instances,
  navigateToTab,
  onRememberInstance,
}: {
  instance: SidebarInstance
  instances: Array<SidebarInstance>
  navigateToTab: (tab: InstanceTab, serverId: string) => void
  onRememberInstance: (id: string) => void
}) {
  const { isMobile } = useSidebar()
  const [open, setOpen] = React.useState(false)

  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <SidebarMenuButton
            size="lg"
            tooltip="Switch server"
            className={`mb-2 h-auto min-h-13 border border-l-2 border-sidebar-border/80 bg-background/45 py-2 ${statusBorderTone(instance.observedState)} group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:min-h-8 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:p-2!`}
          >
            <ServerTypeIcon
              implementation={instance.implementation}
              className="size-4 shrink-0 text-sidebar-foreground/80"
              aria-hidden="true"
            />
            <span className="flex min-w-0 flex-1 flex-col items-start leading-none">
              <span className="w-full truncate text-xs font-semibold">
                {instance.name}
              </span>
              <span className="mt-1 truncate font-mono text-[9px] text-sidebar-foreground/60">
                {instance.implementation} {instance.version} ·{" "}
                {instance.shortId}
              </span>
            </span>
            <ChevronsUpDown className="ml-auto size-3.5! text-sidebar-foreground/60" />
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent
          aria-label="Managed servers"
          side={isMobile ? "bottom" : "right"}
          align="start"
          className="w-64 max-w-[calc(100vw-1rem)] p-1"
        >
          <div className="flex items-center justify-between px-2 py-1.5 text-sm font-semibold">
            <span>Managed servers</span>
            <span className="font-mono text-[10px] font-normal text-muted-foreground">
              {instances.length} discovered
            </span>
          </div>
          <div className="-mx-1 my-1 h-px bg-border" />
          <div className="space-y-0.5">
            {instances.map((item) => {
              const active =
                item.id === instance.id && item.relayId === instance.relayId
              return (
                <button
                  key={`${item.relayId}:${item.id}`}
                  type="button"
                  aria-label={`${item.name}, ${item.implementation} ${item.version}, ${item.observedState}`}
                  aria-pressed={active}
                  className={`flex w-full items-center gap-2.5 rounded-md border-l-2 px-1.5 py-2 text-left transition-colors duration-100 outline-none hover:bg-popover-accent hover:text-popover-accent-foreground focus-visible:bg-popover-accent focus-visible:text-popover-accent-foreground ${statusBorderTone(item.observedState)}`}
                  onClick={() => {
                    setOpen(false)
                    onRememberInstance(item.routeId)
                    navigateToTab(
                      instanceTabFromPathname(window.location.pathname) ??
                        "console",
                      item.routeId
                    )
                  }}
                >
                  <ServerTypeIcon
                    implementation={item.implementation}
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {item.name}
                    </span>
                    <span className="block truncate font-mono text-[9px] text-muted-foreground">
                      {item.implementation} {item.version} · {item.shortId}
                    </span>
                  </span>
                  {active ? (
                    <span className="font-mono text-[9px] text-primary">
                      ACTIVE
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  )
})

function CanonicalInstanceRoute({
  instanceRouteId,
}: {
  instanceRouteId: string
}) {
  const navigate = useNavigate()
  const activeTab = useRouterState({
    select: (state) => instanceTabFromPathname(state.location.pathname),
  })
  const serverId = useRouterState({
    select: (state) =>
      (state.matches.at(-1)?.params as { serverId?: string } | undefined)
        ?.serverId,
  })
  const filePath = useMatch({
    from: "/_app/$serverId/files/$",
    shouldThrow: false,
    select: (match) => match.params._splat,
  })

  // Router state can change through direct navigation and history, so this is
  // URL normalization rather than a deferred user-event handler.
  // oxlint-disable-next-line react-doctor/no-effect-event-handler
  React.useEffect(() => {
    if (!activeTab || instanceRouteId === serverId) return
    if (activeTab === "files") {
      void navigate({
        to: "/$serverId/files/$",
        params: { serverId: instanceRouteId, _splat: filePath ?? "" },
        replace: true,
      })
      return
    }
    void navigate({
      to: activeTab === "info" ? "/$serverId/info" : "/$serverId/console",
      params: { serverId: instanceRouteId },
      replace: true,
    })
  }, [activeTab, filePath, instanceRouteId, navigate, serverId])

  return null
}

const InstanceTabNavigation = React.memo(function InstanceTabNavigation({
  navigateToTab,
}: {
  navigateToTab: (tab: InstanceTab) => void
}) {
  return instanceItems.map((item) => (
    <InstanceTabNavigationItem
      key={item.value}
      item={item}
      navigateToTab={navigateToTab}
    />
  ))
})

const InstanceTabNavigationItem = React.memo(
  function InstanceTabNavigationItem({
    item,
    navigateToTab,
  }: {
    item: (typeof instanceItems)[number]
    navigateToTab: (tab: InstanceTab) => void
  }) {
    const isActive = useRouterState({
      select: (state) =>
        instanceTabFromPathname(state.location.pathname) === item.value,
    })

    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={item.title}
          isActive={isActive}
          type="button"
          className="data-active:bg-primary/10 data-active:text-primary"
          onClick={() => navigateToTab(item.value)}
        >
          <item.icon />
          <span>{item.title}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }
)

function AccountNavigation({
  canManageAccess,
  isPlatformAdmin,
  user,
}: {
  canManageAccess: boolean
  isPlatformAdmin: boolean
  user: AuthenticatedUser
}) {
  const { isMobile } = useSidebar()
  const [signingOut, setSigningOut] = React.useState(false)
  return (
    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={{ children: "Help & docs - Coming Soon", hidden: false }}
            type="button"
            aria-disabled="true"
            tabIndex={-1}
            className="text-sidebar-foreground/35 aria-disabled:pointer-events-auto! aria-disabled:cursor-not-allowed aria-disabled:opacity-100"
          >
            <CircleHelp />
            <span>Help & docs</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={{ children: "Operations - Coming Soon", hidden: false }}
            type="button"
            aria-disabled="true"
            tabIndex={-1}
            className="text-sidebar-foreground/35 aria-disabled:pointer-events-auto! aria-disabled:cursor-not-allowed aria-disabled:opacity-100"
          >
            <ListTodo />
            <span>Operations</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          {canManageAccess ? <AccessNavigationButton /> : null}
        </SidebarMenuItem>
        {isPlatformAdmin ? (
          <SidebarMenuItem>
            <SettingsNavigationButton />
          </SidebarMenuItem>
        ) : null}
        <SidebarMenuItem>
          <div className="flex h-11 items-center gap-2 px-2 group-data-[collapsible=icon]:px-0">
            <Avatar
              size="sm"
              className="rounded-none group-data-[collapsible=icon]:hidden"
            >
              <AvatarFallback className="rounded-none bg-primary/12 text-[10px] font-bold text-primary">
                {initials(user.name)}
              </AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-1 flex-col items-start leading-none group-data-[collapsible=icon]:hidden">
              <span className="w-full truncate text-xs font-semibold">
                {user.name}
              </span>
              <span className="mt-1 w-full truncate text-[10px] text-sidebar-foreground/60">
                {user.isDevelopmentBypass ? "Development bypass" : user.email}
              </span>
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="ml-auto grid size-7 shrink-0 place-items-center text-sidebar-foreground/55 transition-colors group-data-[collapsible=icon]:mx-auto hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/45 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45"
                  aria-label={signingOut ? "Signing out" : "Sign out"}
                  disabled={signingOut}
                  onClick={() => {
                    setSigningOut(true)
                    void signOut(user.isDevelopmentBypass).catch(() => {
                      setSigningOut(false)
                    })
                  }}
                >
                  {signingOut ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <LogOut className="size-4" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" align="center" hidden={isMobile}>
                Logout
              </TooltipContent>
            </Tooltip>
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  )
}

function AccessNavigationButton() {
  const navigate = useNavigate()
  const isActive = useRouterState({
    select: (state) => state.location.pathname === "/access",
  })
  return (
    <SidebarMenuButton
      tooltip="Access"
      isActive={isActive}
      type="button"
      onClick={() => void navigate({ to: "/access" })}
    >
      <UserRoundCog />
      <span>Access</span>
    </SidebarMenuButton>
  )
}

function SettingsNavigationButton() {
  const navigate = useNavigate()
  const isActive = useRouterState({
    select: (state) =>
      state.location.pathname === "/settings" ||
      state.location.pathname.startsWith("/settings/"),
  })
  return (
    <SidebarMenuButton
      tooltip="Settings"
      type="button"
      isActive={isActive}
      onClick={() => void navigate({ to: "/settings" })}
    >
      <Settings />
      <span>Settings</span>
    </SidebarMenuButton>
  )
}

async function signOut(isDevelopmentBypass: boolean) {
  if (isDevelopmentBypass) await disableDevelopmentBypass()
  else await authClient.signOut()
  window.location.assign("/")
}

function initials(name: string): string {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("")
}

function statusBorderTone(state: SidebarInstance["observedState"]): string {
  if (state === "running") return "border-l-emerald-400/80"
  if (state === "failed") return "border-l-red-400/80"
  if (state === "starting" || state === "provisioning") {
    return "border-l-amber-400/70"
  }
  if (state === "stopping") return "border-l-amber-400/45"
  return "border-l-muted-foreground/25"
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

function instanceTabFromPathname(pathname: string): InstanceTab | null {
  if (globalSectionFromPathname(pathname)) return null
  if (/\/files(?:\/|$)/.test(pathname)) return "files"
  if (pathname.endsWith("/info")) return "info"
  return "console"
}
