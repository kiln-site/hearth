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
  Network,
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
  selectSidebarInstanceCount,
  selectSidebarInstanceRoutes,
  selectSidebarInstances,
} from "@/lib/relay-selectors"
import type {
  SidebarInstance,
  SidebarInstanceRoute,
} from "@/lib/relay-selectors"
import { globalSectionFromRouteId } from "@/lib/route-sections"
import type { GlobalSection } from "@/lib/route-sections"
import {
  selectedInstanceCookieName,
  uiPreferenceCookieMaxAge,
} from "@/lib/ui-preference-cookies"

export type InstanceTab = "console" | "files" | "info" | "network"

const instanceItems: Array<{
  title: string
  value: InstanceTab
  icon: typeof TerminalSquare
}> = [
  { title: "Console", value: "console", icon: TerminalSquare },
  { title: "Files", value: "files", icon: Folder },
  { title: "Network", value: "network", icon: Network },
  { title: "Info", value: "info", icon: SlidersHorizontal },
]

function persistSelectedInstance(routeId: string) {
  document.cookie = `${selectedInstanceCookieName}=${routeId}; path=/; max-age=${uiPreferenceCookieMaxAge}; SameSite=Lax`
}

interface AppSidebarViewProps {
  user: AuthenticatedUser
  canManageAccess: boolean
  isPlatformAdmin: boolean
  relayConfigured: boolean
  selectedInstanceRouteId: string | null
}

const emptyInstances: Array<SidebarInstance> = []
const emptyInstanceRoutes: Array<SidebarInstanceRoute> = []

export function AppSidebar({
  selectedInstanceRouteId,
}: {
  selectedInstanceRouteId: string | null
}) {
  const queryClient = useQueryClient()
  const { data: relayConfigured } = useSuspenseQuery({
    ...relayConnectionQueryOptions(queryClient),
    select: selectRelayConfigured,
  })
  const { data: capabilities } = useSuspenseQuery(
    accessCapabilitiesQueryOptions()
  )

  return (
    <AppSidebarView
      canManageAccess={capabilities.canManageAccess}
      isPlatformAdmin={capabilities.isPlatformAdmin}
      relayConfigured={relayConfigured}
      selectedInstanceRouteId={selectedInstanceRouteId}
      user={capabilities.user}
    />
  )
}

const AppSidebarView = React.memo(function AppSidebarView({
  user,
  canManageAccess,
  isPlatformAdmin,
  relayConfigured,
  selectedInstanceRouteId,
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
          isPlatformAdmin={isPlatformAdmin}
          relayConfigured={relayConfigured}
        />

        <SidebarInstanceNavigation
          initialInstanceRouteId={selectedInstanceRouteId}
          relayConfigured={relayConfigured}
        />
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
  isPlatformAdmin,
  relayConfigured,
}: {
  isPlatformAdmin: boolean
  relayConfigured: boolean
}) {
  return (
    <SidebarGroup className="pt-2">
      <SidebarGroupLabel className="text-[10px] tracking-[0.12em] uppercase">
        Infrastructure
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <BricksNavigationItem
            isPlatformAdmin={isPlatformAdmin}
            relayConfigured={relayConfigured}
          />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function BricksNavigationItem({
  isPlatformAdmin,
  relayConfigured,
}: {
  isPlatformAdmin: boolean
  relayConfigured: boolean
}) {
  const { data: instanceCount = 0 } = useQuery({
    ...relaySnapshotQueryOptions(),
    enabled: relayConfigured,
    select: selectSidebarInstanceCount,
  })
  const navigate = useNavigate()
  const isActive = useRouterState({
    select: (state) =>
      globalSectionFromRouteId(state.matches.at(-1)?.routeId) === "bricks",
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

function SidebarInstanceNavigation({
  initialInstanceRouteId,
  relayConfigured,
}: {
  initialInstanceRouteId: string | null
  relayConfigured: boolean
}) {
  const { data: instanceCount = 0 } = useQuery({
    ...relaySnapshotQueryOptions(),
    enabled: relayConfigured,
    select: selectSidebarInstanceCount,
  })

  if (instanceCount === 0) return null

  return (
    <>
      <SidebarSeparator />
      <SelectedInstanceNavigation
        initialInstanceRouteId={initialInstanceRouteId}
      />
    </>
  )
}

const SelectedInstanceNavigation = React.memo(
  function SelectedInstanceNavigation({
    initialInstanceRouteId,
  }: {
    initialInstanceRouteId: string | null
  }) {
    const { data: instanceRoutes = emptyInstanceRoutes } = useQuery({
      ...relaySnapshotQueryOptions(),
      select: selectSidebarInstanceRoutes,
    })
    const serverId = useRouterState({
      select: (state) =>
        (state.matches.at(-1)?.params as { serverId?: string } | undefined)
          ?.serverId,
    })
    const [selectedInstanceRouteId, setSelectedInstanceRouteId] =
      React.useState(initialInstanceRouteId)
    const routeInstance = findRelayInstance(instanceRoutes, serverId)
    const rememberedInstance = findRelayInstance(
      instanceRoutes,
      selectedInstanceRouteId
    )
    const instance = routeInstance ?? rememberedInstance ?? instanceRoutes.at(0)

    const rememberInstance = React.useCallback((instanceId: string) => {
      setSelectedInstanceRouteId(instanceId)
      persistSelectedInstance(instanceId)
    }, [])

    React.useEffect(() => {
      if (routeInstance?.routeId) rememberInstance(routeInstance.routeId)
    }, [rememberInstance, routeInstance?.routeId])

    return instance ? (
      <InstanceNavigation
        instanceRouteId={instance.routeId}
        onRememberInstance={rememberInstance}
      />
    ) : null
  }
)

const InstanceNavigation = React.memo(function InstanceNavigation({
  instanceRouteId,
  onRememberInstance,
}: {
  instanceRouteId: string
  onRememberInstance: (id: string) => void
}) {
  const navigate = useNavigate()
  const selectedInstanceRouteId = React.useRef(instanceRouteId)

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
      if (tab === "network") {
        return navigate({
          to: "/$serverId/network",
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
    selectedInstanceRouteId.current = instanceRouteId
  }, [instanceRouteId])

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-[10px] tracking-[0.12em] uppercase">
        Selected server
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <ServerSelectorBoundary
            instanceRouteId={instanceRouteId}
            navigateToTab={navigateToTab}
            onRememberInstance={onRememberInstance}
          />
          <CanonicalInstanceRoute instanceRouteId={instanceRouteId} />
          <InstanceTabNavigation navigateToTab={navigateToSelectedTab} />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
})

function ServerSelectorBoundary({
  instanceRouteId,
  navigateToTab,
  onRememberInstance,
}: {
  instanceRouteId: string
  navigateToTab: (tab: InstanceTab, serverId: string) => void
  onRememberInstance: (id: string) => void
}) {
  const { data: instances = emptyInstances } = useQuery({
    ...relaySnapshotQueryOptions(),
    select: selectSidebarInstances,
  })
  const instance = findRelayInstance(instances, instanceRouteId)

  return instance ? (
    <ServerSelector
      instance={instance}
      instances={instances}
      navigateToTab={navigateToTab}
      onRememberInstance={onRememberInstance}
    />
  ) : null
}

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
  const selectInstance = React.useCallback(
    (routeId: string) => {
      setOpen(false)
      onRememberInstance(routeId)
      navigateToTab(
        instanceTabFromPathname(window.location.pathname) ?? "console",
        routeId
      )
    },
    [navigateToTab, onRememberInstance]
  )

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
            {instances.map((item) => (
              <ServerSelectorItem
                key={`${item.relayId}:${item.id}`}
                active={
                  item.id === instance.id && item.relayId === instance.relayId
                }
                item={item}
                onSelect={selectInstance}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  )
})

const ServerSelectorItem = React.memo(function ServerSelectorItem({
  active,
  item,
  onSelect,
}: {
  active: boolean
  item: SidebarInstance
  onSelect: (routeId: string) => void
}) {
  return (
    <button
      type="button"
      aria-label={`${item.name}, ${item.implementation} ${item.version}, ${item.observedState}`}
      aria-pressed={active}
      className={`flex w-full items-center gap-2.5 rounded-md border-l-2 px-1.5 py-2 text-left transition-colors duration-100 outline-none hover:bg-popover-accent hover:text-popover-accent-foreground focus-visible:bg-popover-accent focus-visible:text-popover-accent-foreground ${statusBorderTone(item.observedState)}`}
      onClick={() => onSelect(item.routeId)}
    >
      <ServerTypeIcon
        implementation={item.implementation}
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{item.name}</span>
        <span className="block truncate font-mono text-[9px] text-muted-foreground">
          {item.implementation} {item.version} · {item.shortId}
        </span>
      </span>
      {active ? (
        <span className="font-mono text-[9px] text-primary">ACTIVE</span>
      ) : null}
    </button>
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
      to:
        activeTab === "info"
          ? "/$serverId/info"
          : activeTab === "network"
            ? "/$serverId/network"
            : "/$serverId/console",
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
            <SignOutButton
              developmentBypass={user.isDevelopmentBypass}
              tooltipHidden={isMobile}
            />
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  )
}

function SignOutButton({
  developmentBypass,
  tooltipHidden,
}: {
  developmentBypass: boolean
  tooltipHidden: boolean
}) {
  const [signingOut, setSigningOut] = React.useState(false)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="ml-auto grid size-7 shrink-0 place-items-center text-sidebar-foreground/55 transition-colors group-data-[collapsible=icon]:mx-auto hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/45 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45"
          aria-label={signingOut ? "Signing out" : "Sign out"}
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true)
            void signOut(developmentBypass).catch(() => {
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
      <TooltipContent side="right" align="center" hidden={tooltipHidden}>
        Logout
      </TooltipContent>
    </Tooltip>
  )
}

function AccessNavigationButton() {
  const navigate = useNavigate()
  const isActive = useRouterState({
    select: (state) =>
      globalSectionFromRouteId(state.matches.at(-1)?.routeId) === "access",
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
      globalSectionFromRouteId(state.matches.at(-1)?.routeId) === "settings",
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
  if (pathname.endsWith("/network")) return "network"
  if (pathname.endsWith("/info")) return "info"
  return "console"
}
