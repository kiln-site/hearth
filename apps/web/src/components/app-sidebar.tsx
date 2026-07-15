import {
  Boxes,
  ChevronsUpDown,
  CircleHelp,
  File,
  FileText,
  ListTodo,
  Server,
  Settings,
  SlidersHorizontal,
  TerminalSquare,
  UserRoundCog,
} from "lucide-react"
import type { RelayInstance } from "@workspace/contracts"
import { Link, useNavigate } from "@tanstack/react-router"

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

import { HearthMark } from "@/components/hearth-mark"
import { ServerTypeIcon } from "@/components/server-type-icon"
import { authClient } from "@/lib/auth-client"
import type { AuthenticatedUser } from "@/lib/auth-session"
import { disableDevelopmentBypass } from "@/server/auth"

export type InstanceTab = "console" | "files" | "info"
export type GlobalSection = "access" | "bricks" | "security" | "settings" | null

const instanceItems: Array<{
  title: string
  value: InstanceTab
  icon: typeof TerminalSquare
}> = [
  { title: "Console", value: "console", icon: TerminalSquare },
  { title: "Files", value: "files", icon: File },
  { title: "Info", value: "info", icon: SlidersHorizontal },
]

export function AppSidebar({
  instances,
  instance,
  user,
  activeTab,
  activeSection,
  canManageAccess,
  isPlatformAdmin,
  onInstanceChange,
  onTabChange,
}: {
  instances: Array<RelayInstance>
  instance?: RelayInstance
  user: AuthenticatedUser
  activeTab: InstanceTab | null
  activeSection: GlobalSection
  canManageAccess: boolean
  isPlatformAdmin: boolean
  onInstanceChange: (id: string) => void
  onTabChange: (tab: InstanceTab) => void
}) {
  const navigate = useNavigate()
  const { isMobile } = useSidebar()
  const platformItems = [
    {
      title: "Bricks",
      icon: Boxes,
      badge: String(instances.length),
      to: "/bricks",
    },
    { title: "Relays", icon: Server, badge: "1", to: "/settings" },
  ] as const
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
        <SidebarGroup className="pt-2">
          <SidebarGroupLabel className="text-[10px] tracking-[0.12em] uppercase">
            Infrastructure
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {platformItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={
                      activeSection ===
                      (item.to === "/bricks" ? "bricks" : "settings")
                    }
                    className="data-active:bg-primary/10 data-active:text-primary"
                    asChild
                  >
                    <Link to={item.to}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                  <SidebarMenuBadge className="text-sidebar-foreground/45">
                    {item.badge}
                  </SidebarMenuBadge>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {instance ? <SidebarSeparator /> : null}

        {instance ? (
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
                        tooltip={`Switch server — ${instance.name} (${instance.observedState})`}
                        className={`mb-2 h-auto min-h-13 border border-l-2 border-sidebar-border/80 bg-background/45 py-2 ${statusBorderTone(instance.observedState)} group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:min-h-8 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:p-2!`}
                      >
                        <ServerTypeIcon
                          implementation={instance.implementation}
                          className="size-4 shrink-0 text-sidebar-foreground/70"
                          aria-hidden="true"
                        />
                        <span className="flex min-w-0 flex-1 flex-col items-start leading-none">
                          <span className="w-full truncate text-xs font-semibold">
                            {instance.name}
                          </span>
                          <span className="mt-1 truncate font-mono text-[9px] text-sidebar-foreground/45">
                            {instance.implementation} {instance.version} ·{" "}
                            {instance.shortId}
                          </span>
                        </span>
                        <ChevronsUpDown className="ml-auto size-3.5! text-sidebar-foreground/45" />
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
                              {item.implementation} {item.version} ·{" "}
                              {item.shortId}
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
        ) : null}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Help & documentation" type="button">
              <CircleHelp />
              <span>Help & docs</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Operations" type="button">
              <ListTodo />
              <span>Operations</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            {canManageAccess ? (
              <SidebarMenuButton
                tooltip="Users, roles, and invitations"
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
                tooltip="Application settings and account security"
                isActive={activeSection === "settings"}
                type="button"
                onClick={() => void navigate({ to: "/settings" })}
              >
                <Settings />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="h-11 group-data-[collapsible=icon]:justify-center"
                >
                  <Avatar size="sm" className="rounded-none">
                    <AvatarFallback className="rounded-none bg-primary/12 text-[10px] font-bold text-primary">
                      {initials(user.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-1 flex-col items-start leading-none group-data-[collapsible=icon]:hidden">
                    <span className="truncate text-xs font-semibold">
                      {user.name}
                    </span>
                    <span className="mt-1 truncate text-[10px] text-sidebar-foreground/45">
                      {user.isDevelopmentBypass
                        ? "Development bypass"
                        : user.email}
                    </span>
                  </span>
                  <ChevronsUpDown className="ml-auto size-3.5! text-sidebar-foreground/45 group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuLabel className="min-w-0">
                  <span className="block truncate">{user.name}</span>
                  <span className="block truncate text-[10px] font-normal text-muted-foreground">
                    {user.email}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => void navigate({ to: "/security" })}
                >
                  <FileText /> Account settings
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    void signOut(user.isDevelopmentBypass)
                  }}
                >
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
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

function statusBorderTone(state: RelayInstance["observedState"]): string {
  if (state === "running") return "border-l-emerald-400/80"
  if (state === "failed") return "border-l-red-400/80"
  if (state === "starting" || state === "provisioning") {
    return "border-l-amber-400/70"
  }
  if (state === "stopping") return "border-l-amber-400/45"
  return "border-l-muted-foreground/25"
}
