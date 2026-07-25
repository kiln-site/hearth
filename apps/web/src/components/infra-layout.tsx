import * as React from "react"
import { Link, Outlet } from "@tanstack/react-router"
import { Database, RadioTower, Server, Wrench } from "lucide-react"

const infraTabs = [
  { label: "Setup", to: "/infra/setup", icon: Wrench },
  { label: "Relays", to: "/infra/relays", icon: RadioTower },
  { label: "Servers", to: "/infra/servers", icon: Server },
  { label: "Databases", to: "/infra/databases", icon: Database },
] as const

export const InfraShell = React.memo(function InfraShell({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-full bg-background">
      <header className="mx-auto w-full max-w-[90rem] px-3 pt-3 sm:px-5">
        <InfraNavigation />
      </header>
      <div data-slot="infra-content" className="[contain:paint]">
        {children}
      </div>
    </div>
  )
})

export function InfraRouteOutlet() {
  return <Outlet />
}

const InfraNavigation = React.memo(function InfraNavigation() {
  return (
    <nav
      aria-label="Infrastructure sections"
      className="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b"
    >
      {infraTabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className="relative flex h-10 shrink-0 items-center gap-2 px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          activeProps={{
            className:
              "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-primary",
          }}
        >
          <tab.icon className="size-3.5" />
          {tab.label}
        </Link>
      ))}
    </nav>
  )
})
