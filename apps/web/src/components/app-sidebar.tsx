import * as React from "react"
import {
  Boxes,
  ChevronsUpDown,
  CircleHelp,
  Folder,
  ListTodo,
  LoaderCircle,
  LogOut,
  Server,
  Settings,
  SlidersHorizontal,
  TerminalSquare,
  UserRoundCog,
} from "lucide-react"
import { useNavigate } from "@tanstack/react-router"

import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
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
import { disableDevelopmentBypass } from "@/server/auth"
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

interface AppSidebarProps {
  instances: Array<SidebarInstance>
  instance?: SidebarInstance
  user: AuthenticatedUser
  activeTab: InstanceTab | null
  activeSection: GlobalSection
  canManageAccess: boolean
  isPlatformAdmin: boolean
  relayStatus: "connected" | "unconfigured" | "unreachable"
  relayName?: string
  onInstanceChange: (id: string) => void
  onTabChange: (tab: InstanceTab) => void
}

export const AppSidebar = React.memo(function AppSidebar({
  instances,
  instance,
  user,
  activeTab,
  activeSection,
  canManageAccess,
  isPlatformAdmin,
  relayStatus,
  relayName,
  onInstanceChange,
  onTabChange,
}: AppSidebarProps) {
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
          activeSection={activeSection}
          instanceCount={instances.length}
          isPlatformAdmin={isPlatformAdmin}
          relayName={relayName}
          relayStatus={relayStatus}
        />

        {instance ? <SidebarSeparator /> : null}

        {instance ? (
          <InstanceNavigation
            activeTab={activeTab}
            instance={instance}
            instances={instances}
            onInstanceChange={onInstanceChange}
            onTabChange={onTabChange}
          />
        ) : null}
      </SidebarContent>

      <AccountNavigation
        activeSection={activeSection}
        canManageAccess={canManageAccess}
        isPlatformAdmin={isPlatformAdmin}
        user={user}
      />
    </Sidebar>
  )
})

function InfrastructureNavigation({
  activeSection,
  instanceCount,
  isPlatformAdmin,
  relayName,
  relayStatus,
}: {
  activeSection: GlobalSection
  instanceCount: number
  isPlatformAdmin: boolean
  relayName?: string
  relayStatus: "connected" | "unconfigured" | "unreachable"
}) {
  const navigate = useNavigate()
  return (
    <SidebarGroup className="pt-2">
      <SidebarGroupLabel className="text-[10px] tracking-[0.12em] uppercase">
        Infrastructure
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={
                isPlatformAdmin
                  ? "Bricks"
                  : "Brick provisioning is administrator-only"
              }
              type="button"
              isActive={activeSection === "bricks"}
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
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={
                isPlatformAdmin
                  ? "Relays"
                  : (relayName ?? "Relay configuration is administrator-only")
              }
              type="button"
              isActive={activeSection === "settings"}
              aria-disabled={!isPlatformAdmin}
              tabIndex={isPlatformAdmin ? 0 : -1}
              className={
                isPlatformAdmin
                  ? "data-active:bg-primary/10 data-active:text-primary"
                  : "text-sidebar-foreground/35 aria-disabled:pointer-events-auto! aria-disabled:cursor-not-allowed aria-disabled:opacity-100"
              }
              onClick={() => {
                if (isPlatformAdmin) void navigate({ to: "/settings" })
              }}
            >
              <Server />
              <span>Relays</span>
            </SidebarMenuButton>
            <SidebarMenuBadge className={relayBadgeTone(relayStatus)}>
              {relayStatus === "unconfigured" ? "0" : "1"}
            </SidebarMenuBadge>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function InstanceNavigation({
  activeTab,
  instance,
  instances,
  onInstanceChange,
  onTabChange,
}: {
  activeTab: InstanceTab | null
  instance: SidebarInstance
  instances: Array<SidebarInstance>
  onInstanceChange: (id: string) => void
  onTabChange: (tab: InstanceTab) => void
}) {
  const { isMobile } = useSidebar()
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-[10px] tracking-[0.12em] uppercase">
        Selected server
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
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
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side={isMobile ? "bottom" : "right"}
                align="start"
                className="w-64 max-w-[calc(100vw-1rem)]"
              >
                <DropdownMenuLabel className="flex items-center justify-between">
                  <span>Managed servers</span>
                  <span className="font-mono text-[10px] font-normal text-muted-foreground">
                    {instances.length} discovered
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {instances.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    className={`gap-2.5 border-l-2 py-2 ${statusBorderTone(item.observedState)}`}
                    aria-label={`${item.name}, ${item.implementation} ${item.version}, ${item.observedState}`}
                    onSelect={() => onInstanceChange(item.shortId)}
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
                    {item.id === instance.id ? (
                      <span className="font-mono text-[9px] text-primary">
                        ACTIVE
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
          {instanceItems.map((item) => (
            <SidebarMenuItem key={item.value}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={activeTab === item.value}
                type="button"
                className="data-active:bg-primary/10 data-active:text-primary"
                onClick={() => onTabChange(item.value)}
              >
                <item.icon />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function AccountNavigation({
  activeSection,
  canManageAccess,
  isPlatformAdmin,
  user,
}: {
  activeSection: GlobalSection
  canManageAccess: boolean
  isPlatformAdmin: boolean
  user: AuthenticatedUser
}) {
  const navigate = useNavigate()
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
          {canManageAccess ? (
            <SidebarMenuButton
              tooltip="Access"
              isActive={activeSection === "access"}
              type="button"
              onClick={() => void navigate({ to: "/access" })}
            >
              <UserRoundCog />
              <span>Access</span>
            </SidebarMenuButton>
          ) : null}
        </SidebarMenuItem>
        {isPlatformAdmin ? (
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Settings"
              type="button"
              isActive={activeSection === "settings"}
              onClick={() => void navigate({ to: "/settings" })}
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
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

function relayBadgeTone(
  status: "connected" | "unconfigured" | "unreachable"
): string {
  if (status === "connected") return "text-emerald-400"
  if (status === "unreachable") return "text-amber-400"
  return "text-sidebar-foreground/35"
}
