import * as React from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { Link, Outlet } from "@tanstack/react-router"
import {
  CloudDownload,
  Database,
  RadioTower,
  Server,
  Wrench,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import { InfraUpdatesDialog } from "@/components/infra-updates-dialog"
import { accessCapabilitiesQueryOptions } from "@/lib/query-options"

const infraTabs = [
  { label: "Setup", to: "/infra/setup", icon: Wrench },
  { label: "Relays", to: "/infra/relays", icon: RadioTower },
  { label: "Servers", to: "/infra/servers", icon: Server },
  { label: "Databases", to: "/infra/databases", icon: Database },
] as const

type InfraUpdateDialogState = {
  open: boolean
  relayId: string | null
  requestId: number
}

export interface InfraUpdateDialogStore {
  close: () => void
  getServerSnapshot: () => InfraUpdateDialogState
  getSnapshot: () => InfraUpdateDialogState
  open: (relayId?: string) => void
  subscribe: (listener: () => void) => () => void
}

const closedUpdateDialogState: InfraUpdateDialogState = {
  open: false,
  relayId: null,
  requestId: 0,
}

const InfraUpdateDialogContext =
  React.createContext<InfraUpdateDialogStore | null>(null)

function createInfraUpdateDialogStore(): InfraUpdateDialogStore {
  let state = closedUpdateDialogState
  const listeners = new Set<() => void>()

  function publish(nextState: InfraUpdateDialogState) {
    state = nextState
    for (const listener of listeners) listener()
  }

  return {
    close: () =>
      publish({
        open: false,
        relayId: null,
        requestId: state.requestId,
      }),
    getServerSnapshot: () => closedUpdateDialogState,
    getSnapshot: () => state,
    open: (relayId) =>
      publish({
        open: true,
        relayId: relayId ?? null,
        requestId: state.requestId + 1,
      }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function useInfraUpdateDialogStore(): InfraUpdateDialogStore {
  const store = React.useContext(InfraUpdateDialogContext)
  if (!store) {
    throw new Error(
      "useInfraUpdateDialogStore must be used inside the Infrastructure shell"
    )
  }
  return store
}

export const InfraShell = React.memo(function InfraShell({
  children,
}: {
  children: React.ReactNode
}) {
  const [updateDialogStore] = React.useState(createInfraUpdateDialogStore)

  return (
    <InfraUpdateDialogContext.Provider value={updateDialogStore}>
      <div className="min-h-full bg-background">
        <header className="mx-auto w-full max-w-[90rem] px-3 pt-3 sm:px-5">
          <InfraNavigation />
        </header>
        <div data-slot="infra-content" className="[contain:paint]">
          {children}
        </div>
      </div>
      <InfraUpdatesDialogHost store={updateDialogStore} />
    </InfraUpdateDialogContext.Provider>
  )
})

export function InfraRouteOutlet() {
  return <Outlet />
}

const InfraNavigation = React.memo(function InfraNavigation() {
  const store = useInfraUpdateDialogStore()
  const { data: capabilities } = useSuspenseQuery(
    accessCapabilitiesQueryOptions()
  )

  return (
    <div className="mb-6 flex min-w-0 items-center gap-2 border-b">
      <nav
        aria-label="Infrastructure sections"
        className="no-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto overflow-y-hidden"
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
      {capabilities.isPlatformAdmin ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Review system updates"
              className="mb-1 h-8 shrink-0 px-2 sm:px-2.5"
              size="sm"
              type="button"
              variant="outline"
              onClick={() => store.open()}
            >
              <CloudDownload />
              <span className="hidden sm:inline">Updates</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            Review system updates
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
})

const InfraUpdatesDialogHost = React.memo(function InfraUpdatesDialogHost({
  store,
}: {
  store: InfraUpdateDialogStore
}) {
  const state = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot
  )

  return (
    <InfraUpdatesDialog
      initialRelayId={state.relayId}
      key={state.requestId}
      open={state.open}
      onOpenChange={(open) => {
        if (!open) store.close()
      }}
    />
  )
})
