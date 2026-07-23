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
  Server as ServerIcon,
  Settings,
  SlidersHorizontal,
  TerminalSquare,
  UserRoundCog,
} from "lucide-react"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"

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
import {
  findFirstCanonicalRelayInstance,
  resolveCanonicalRelayInstance,
  selectRelayConfigured,
  selectSidebarInstanceCount,
  selectSidebarInstances,
} from "@/lib/relay-selectors"
import type { SidebarInstance } from "@/lib/relay-selectors"
import { globalSectionFromRouteId } from "@/lib/route-sections"
import type { GlobalSection } from "@/lib/route-sections"
import {
  selectedInstanceCookieName,
  uiPreferenceCookieMaxAge,
} from "@/lib/ui-preference-cookies"
import { warmFileWorkspaceModule } from "@/lib/workspace-module-preloads"

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

function readSelectedInstance(): string | null {
  if (typeof document === "undefined") return null

  return (
    document.cookie
      .split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${selectedInstanceCookieName}=`))
      ?.slice(selectedInstanceCookieName.length + 1) ?? null
  )
}

function persistSelectedInstance(routeId: string) {
  const currentRouteId = readSelectedInstance()
  if (currentRouteId === routeId) return

  document.cookie = `${selectedInstanceCookieName}=${routeId}; path=/; max-age=${uiPreferenceCookieMaxAge}; SameSite=Lax`
}

interface AppSidebarViewProps {
  user: AuthenticatedUser
  canManageAccess: boolean
  isPlatformAdmin: boolean
  initialSelectedInstanceRouteId: string | null
  relayConfigured: boolean
}

const emptyInstances: Array<SidebarInstance> = []

export const AppSidebar = React.memo(function AppSidebar({
  initialSelectedInstanceRouteId,
}: {
  initialSelectedInstanceRouteId: string | null
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
      initialSelectedInstanceRouteId={initialSelectedInstanceRouteId}
      relayConfigured={relayConfigured}
      user={capabilities.user}
    />
  )
})

const AppSidebarView = React.memo(function AppSidebarView({
  user,
  canManageAccess,
  isPlatformAdmin,
  initialSelectedInstanceRouteId,
  relayConfigured,
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
          initialSelectedInstanceRouteId={initialSelectedInstanceRouteId}
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
          <ServersNavigationItem relayConfigured={relayConfigured} />
          <BricksNavigationItem
            isPlatformAdmin={isPlatformAdmin}
            relayConfigured={relayConfigured}
          />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function ServersNavigationItem({
  relayConfigured,
}: {
  relayConfigured: boolean
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        tooltip="Servers"
        className="data-active:bg-primary/10 data-active:text-primary"
      >
        <Link
          to="/servers"
          activeOptions={{ exact: true, includeSearch: false }}
          activeProps={{ "data-active": true }}
          preload="intent"
        >
          <ServerIcon />
          <span>Servers</span>
        </Link>
      </SidebarMenuButton>
      <SidebarMenuBadge className="text-sidebar-foreground/25">
        <InfrastructureInstanceCount relayConfigured={relayConfigured} />
      </SidebarMenuBadge>
    </SidebarMenuItem>
  )
}

function BricksNavigationItem({
  isPlatformAdmin,
  relayConfigured,
}: {
  isPlatformAdmin: boolean
  relayConfigured: boolean
}) {
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
        <InfrastructureInstanceCount relayConfigured={relayConfigured} />
      </SidebarMenuBadge>
    </SidebarMenuItem>
  )
}

const InfrastructureInstanceCount = React.memo(
  function InfrastructureInstanceCount({
    relayConfigured,
  }: {
    relayConfigured: boolean
  }) {
    const { data: instanceCount = 0 } = useQuery({
      ...relaySnapshotQueryOptions(),
      enabled: relayConfigured,
      select: selectSidebarInstanceCount,
    })

    return instanceCount
  }
)

function SidebarInstanceNavigation({
  initialSelectedInstanceRouteId,
  relayConfigured,
}: {
  initialSelectedInstanceRouteId: string | null
  relayConfigured: boolean
}) {
  const { data: instances = emptyInstances } = useQuery({
    ...relaySnapshotQueryOptions(),
    enabled: relayConfigured,
    select: selectSidebarInstances,
  })
  const serverId = useRouterState({
    select: (state) =>
      (state.matches.at(-1)?.params as { serverId?: string } | undefined)
        ?.serverId,
  })
  const selectedInstanceRouteId = React.useMemo(
    () => serverId ?? readSelectedInstance() ?? initialSelectedInstanceRouteId,
    [initialSelectedInstanceRouteId, serverId]
  )
  const preferredResolution = resolveCanonicalRelayInstance(
    instances,
    selectedInstanceRouteId
  )
  const instance =
    preferredResolution.status === "found"
      ? preferredResolution.instance
      : serverId || preferredResolution.status === "ambiguous"
        ? null
        : (findFirstCanonicalRelayInstance(instances) ?? null)
  return (
    <>
      {instance ? (
        <RememberSelectedInstance instanceRouteId={instance.shortId} />
      ) : null}
      <SidebarSeparator />
      <InstanceNavigation
        instance={instance}
        instances={instances}
        unresolvedServerId={
          serverId ??
          (preferredResolution.status === "ambiguous"
            ? (selectedInstanceRouteId ?? undefined)
            : undefined)
        }
      />
    </>
  )
}

function RememberSelectedInstance({
  instanceRouteId,
}: {
  instanceRouteId: string
}) {
  React.useEffect(() => {
    persistSelectedInstance(instanceRouteId)
  }, [instanceRouteId])

  return null
}

const InstanceNavigation = React.memo(function InstanceNavigation({
  instance,
  instances,
  unresolvedServerId,
}: {
  instance: SidebarInstance | null
  instances: Array<SidebarInstance>
  unresolvedServerId: string | undefined
}) {
  const navigate = useNavigate()
  const instanceRouteId = instance?.shortId ?? null

  const navigateToTab = React.useCallback(
    (tab: InstanceTab, nextServerId: string, replace = false) => {
      if (tab === "files") {
        return navigate({
          to: "/server/$serverId/files/$",
          params: { serverId: nextServerId, _splat: "" },
          replace,
        })
      }
      if (tab === "info") {
        return navigate({
          to: "/server/$serverId/info",
          params: { serverId: nextServerId },
          replace,
        })
      }
      if (tab === "network") {
        return navigate({
          to: "/server/$serverId/network",
          params: { serverId: nextServerId },
          replace,
        })
      }
      return navigate({
        to: "/server/$serverId/console",
        params: { serverId: nextServerId },
        replace,
      })
    },
    [navigate]
  )

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
          />
          <InstanceTabNavigation
            instanceRouteId={instanceRouteId}
            unresolvedServerId={unresolvedServerId}
          />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
})

function ambiguousServerHref(shortId: string) {
  return `/servers?search=${encodeURIComponent(shortId)}`
}

const ServerSelector = React.memo(function ServerSelector({
  instance,
  instances,
  navigateToTab,
}: {
  instance: SidebarInstance | null
  instances: Array<SidebarInstance>
  navigateToTab: (tab: InstanceTab, serverId: string) => void
}) {
  const { isMobile } = useSidebar()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const selectInstance = React.useCallback(
    (routeId: string) => {
      setOpen(false)
      const snapshot = queryClient.getQueryData(
        relaySnapshotQueryOptions().queryKey
      )
      if (!snapshot) return
      const resolution = resolveCanonicalRelayInstance(
        selectSidebarInstances(snapshot),
        routeId
      )
      if (resolution.status === "ambiguous") {
        void navigate({ href: ambiguousServerHref(routeId) })
        return
      }
      if (resolution.status === "not-found") return

      navigateToTab(
        instanceTabFromPathname(window.location.pathname) ?? "console",
        resolution.instance.shortId
      )
    },
    [navigate, navigateToTab, queryClient]
  )

  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <SidebarMenuButton
            size="lg"
            tooltip="Switch server"
            className={`mb-2 h-auto min-h-13 border border-l-2 border-sidebar-border/80 bg-background/45 py-2 ${instance ? statusBorderTone(instance.observedState) : "border-l-muted-foreground/25"} group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:min-h-8 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:p-2!`}
          >
            <ServerTypeIcon
              implementation={instance?.implementation ?? ""}
              className="size-4 shrink-0 text-sidebar-foreground/80"
              aria-hidden="true"
            />
            <span className="flex min-w-0 flex-1 flex-col items-start leading-none">
              <span className="w-full truncate text-xs font-semibold">
                {instance?.name ?? "Choose a server"}
              </span>
              <span className="mt-1 truncate font-mono text-[9px] text-sidebar-foreground/60">
                {instance
                  ? `${instance.implementation} ${instance.version} · ${instance.shortId}`
                  : instances.length === 0
                    ? "No managed servers"
                    : "Selection required"}
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
          {instances.length > 0 ? (
            <div className="space-y-0.5">
              {instances.map((item) => (
                <ServerSelectorItem
                  key={`${item.relayId}:${item.id}`}
                  active={
                    item.id === instance?.id &&
                    item.relayId === instance.relayId
                  }
                  item={item}
                  onSelect={selectInstance}
                />
              ))}
            </div>
          ) : (
            <div className="px-2 py-3">
              <p className="text-xs font-medium">No managed servers</p>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                Open the server workspace to provision or discover a server.
              </p>
              <Link
                to="/servers"
                className="mt-2 inline-flex text-[10px] font-medium text-primary hover:underline"
              >
                View servers
              </Link>
            </div>
          )}
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
      onClick={() => onSelect(item.shortId)}
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

const InstanceTabNavigation = React.memo(function InstanceTabNavigation({
  instanceRouteId,
  unresolvedServerId,
}: {
  instanceRouteId: string | null
  unresolvedServerId: string | undefined
}) {
  return instanceItems.map((item) => (
    <InstanceTabNavigationItem
      key={item.value}
      item={item}
      instanceRouteId={instanceRouteId}
      unresolvedServerId={unresolvedServerId}
    />
  ))
})

const InstanceTabNavigationItem = React.memo(
  function InstanceTabNavigationItem({
    item,
    instanceRouteId,
    unresolvedServerId,
  }: {
    item: (typeof instanceItems)[number]
    instanceRouteId: string | null
    unresolvedServerId: string | undefined
  }) {
    const content = (
      <>
        <item.icon />
        <span>{item.title}</span>
      </>
    )

    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          tooltip={item.title}
          className="data-active:bg-primary/10 data-active:text-primary"
        >
          {!instanceRouteId ? (
            <Link
              to="/servers"
              search={unresolvedServerId ? { search: unresolvedServerId } : {}}
              activeOptions={{ exact: true, includeSearch: false }}
            >
              {content}
            </Link>
          ) : item.value === "console" ? (
            <Link
              to="/server/$serverId/console"
              params={{ serverId: instanceRouteId }}
              activeOptions={{ exact: true }}
              activeProps={{ "data-active": true }}
              preload="render"
            >
              {content}
            </Link>
          ) : item.value === "files" ? (
            <Link
              to="/server/$serverId/files/$"
              params={{ serverId: instanceRouteId, _splat: "" }}
              activeProps={{ "data-active": true }}
              preload="intent"
              onFocus={warmFileWorkspaceModule}
              onMouseEnter={warmFileWorkspaceModule}
              onTouchStart={warmFileWorkspaceModule}
            >
              {content}
            </Link>
          ) : item.value === "network" ? (
            <Link
              to="/server/$serverId/network"
              params={{ serverId: instanceRouteId }}
              activeOptions={{ exact: true }}
              activeProps={{ "data-active": true }}
              preload="intent"
            >
              {content}
            </Link>
          ) : (
            <Link
              to="/server/$serverId/info"
              params={{ serverId: instanceRouteId }}
              activeOptions={{ exact: true }}
              activeProps={{ "data-active": true }}
              preload="intent"
            >
              {content}
            </Link>
          )}
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
  if (pathname === "/servers") return "servers"
  if (pathname === "/access") return "access"
  if (pathname === "/security") return "security"
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return "settings"
  }
  return null
}

function instanceTabFromPathname(pathname: string): InstanceTab | null {
  if (globalSectionFromPathname(pathname)) return null
  if (/^\/server\/[^/]+\/files(?:\/|$)/.test(pathname)) return "files"
  if (/^\/server\/[^/]+\/network\/?$/.test(pathname)) return "network"
  if (/^\/server\/[^/]+\/info\/?$/.test(pathname)) return "info"
  if (/^\/server\/[^/]+\/console\/?$/.test(pathname)) return "console"
  return null
}
