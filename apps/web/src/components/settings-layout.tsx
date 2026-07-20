import { Link, Outlet } from "@tanstack/react-router"
import { CircleUserRound, CreditCard, Palette, RadioTower } from "lucide-react"

import { GlobalPageToolbar } from "@/components/global-page-toolbar"

const settingsTabs = [
  { label: "Relays", to: "/settings/relays", icon: RadioTower },
  { label: "Appearance", to: "/settings/appearance", icon: Palette },
  { label: "Account", to: "/settings/account", icon: CircleUserRound },
  { label: "Billing", to: "/settings/billing", icon: CreditCard },
] as const

export function SettingsLayout() {
  return (
    <main className="h-full min-h-0 overflow-y-auto bg-background">
      <GlobalPageToolbar label="Settings" />
      <header className="mx-auto w-full max-w-6xl px-5 pt-9">
        <p className="font-mono text-[10px] tracking-[0.18em] text-primary uppercase">
          Application settings
        </p>
        <h1 className="mt-2 font-heading text-3xl font-semibold tracking-[-0.04em]">
          Settings
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Configure Hearth, its Relay fleet, and your account preferences.
        </p>
        <nav
          aria-label="Settings sections"
          className="mt-7 mb-6 flex gap-1 overflow-x-auto border-b"
        >
          {settingsTabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              className="relative flex h-10 shrink-0 items-center gap-2 px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{
                className:
                  "text-foreground after:absolute after:inset-x-2 after:bottom-[-1px] after:h-0.5 after:bg-primary",
              }}
            >
              <tab.icon className="size-3.5" />
              {tab.label}
            </Link>
          ))}
        </nav>
      </header>
      <div data-slot="settings-content" className="[contain:paint]">
        <Outlet />
      </div>
    </main>
  )
}
