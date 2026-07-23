import * as React from "react"
import { useRouterState } from "@tanstack/react-router"

import { SidebarTrigger } from "@workspace/ui/components/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

export const GlobalPageToolbar = React.memo(function GlobalPageToolbar({
  label,
  settings = false,
}: {
  label: string
  settings?: boolean
}) {
  return (
    <header className="shrink-0 border-b bg-background/90 backdrop-blur-xl">
      <div className="flex min-h-20 items-center gap-3 px-3 py-3 sm:px-5 lg:py-2">
        <ToolbarSidebarTrigger />
        <span className="h-6 w-px shrink-0 bg-border/80" aria-hidden="true" />
        {settings ? (
          <SettingsIdentity />
        ) : (
          <div className="min-w-0">
            <p className="font-mono text-[9px] tracking-[0.16em] text-primary uppercase">
              {sectionFromLabel(label)}
            </p>
            <h1 className="mt-0.5 truncate font-heading text-xl font-semibold tracking-[-0.035em]">
              {titleFromLabel(label)}
            </h1>
          </div>
        )}
      </div>
    </header>
  )
})

const SettingsIdentity = React.memo(function SettingsIdentity() {
  return (
    <div className="min-w-0 flex-1">
      <h1 className="flex min-w-0 items-baseline gap-1.5 font-heading tracking-[-0.03em]">
        <span className="shrink-0 text-lg font-semibold text-foreground sm:text-xl">
          Settings
        </span>
        <span className="shrink-0 text-border">/</span>
        <span className="min-w-0 truncate text-sm font-medium text-muted-foreground sm:text-base">
          <SettingsRouteTitle />
        </span>
      </h1>
      <HearthBuildMetadata />
    </div>
  )
})

function SettingsRouteTitle() {
  const title = useRouterState({
    select: (state) => settingsPageFromPathname(state.location.pathname),
  })
  return <>{title}</>
}

function settingsPageFromPathname(pathname: string) {
  if (pathname.startsWith("/settings/relays")) return "Relays"
  if (pathname.startsWith("/settings/appearance")) return "Appearance"
  if (pathname.startsWith("/settings/account")) return "Account"
  if (pathname.startsWith("/settings/billing")) return "Billing"
  return "Settings"
}

const HearthBuildMetadata = React.memo(function HearthBuildMetadata() {
  const version = import.meta.env.VITE_KILN_VERSION
  const commit = import.meta.env.VITE_KILN_SOURCE_SHA
  const shortCommit = commit ? commit.slice(0, 8) : "Development"

  return (
    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-[10px] whitespace-nowrap text-muted-foreground sm:text-xs">
      <span className="shrink-0">Hearth {version}</span>
      <span className="text-border" aria-hidden="true">
        /
      </span>
      <span
        className="shrink-0 font-mono"
        title={commit ? `Build ${commit}` : undefined}
      >
        {shortCommit}
      </span>
      <span className="text-border" aria-hidden="true">
        /
      </span>
      <CurrentSiteHost />
    </div>
  )
})

const CurrentSiteHost = React.memo(function CurrentSiteHost() {
  const host = React.useSyncExternalStore(
    subscribeToStaticBrowserValue,
    currentSiteHost,
    emptySiteHost
  )

  return <span className="min-w-0 truncate font-mono">{host}</span>
})

function subscribeToStaticBrowserValue() {
  return () => undefined
}

function currentSiteHost() {
  return window.location.host
}

function emptySiteHost() {
  return ""
}

function sectionFromLabel(label: string) {
  const separator = label.indexOf(" / ")
  return separator === -1 ? "Hearth" : label.slice(0, separator)
}

function titleFromLabel(label: string) {
  const separator = label.lastIndexOf(" / ")
  return separator === -1 ? label : label.slice(separator + 3)
}

export const ToolbarSidebarTrigger = React.memo(
  function ToolbarSidebarTrigger() {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarTrigger
            className="-ml-1 size-8 shrink-0 text-muted-foreground shadow-none hover:bg-accent/70 hover:text-foreground"
            aria-label="Toggle sidebar"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          Toggle sidebar
        </TooltipContent>
      </Tooltip>
    )
  }
)
