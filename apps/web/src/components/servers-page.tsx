import * as React from "react"
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  ArrowUpRight,
  ListTodo,
  Plus,
  RefreshCw,
  Search,
  Server,
  X,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import { ServerTypeIcon } from "@/components/server-type-icon"
import {
  WorkspaceDataTable,
  WorkspaceTableCell,
  WorkspaceTableHead,
  WorkspaceTableHeading,
  createWorkspaceTableSearchStore,
  useWorkspaceTableSearchInput,
} from "@/components/workspace-data-table"
import type { WorkspaceTableSearchStore } from "@/components/workspace-data-table"
import {
  relayConnectionQueryOptions,
  relaySnapshotQueryOptions,
} from "@/lib/query-options"
import {
  selectRelayConfigured,
  selectServerListInstances,
} from "@/lib/relay-selectors"
import type { ServerListInstance } from "@/lib/relay-selectors"

const emptyServers: Array<ServerListInstance> = []
const minimumManualSyncFeedbackMs = 500

export type ServerSearchStore = WorkspaceTableSearchStore

export function createServerSearchStore(
  initialValue: string
): ServerSearchStore {
  return createWorkspaceTableSearchStore(initialValue)
}

export const ServersPage = React.memo(function ServersPage({
  canProvision,
  searchStore,
}: {
  canProvision: boolean
  searchStore: ServerSearchStore
}) {
  const queryClient = useQueryClient()
  const { data: relayConfigured } = useSuspenseQuery({
    ...relayConnectionQueryOptions(queryClient),
    select: selectRelayConfigured,
  })

  return (
    <div className="mx-auto w-full max-w-[90rem] px-3 py-3 pb-10 sm:px-5 sm:py-5">
      <section
        data-slot="servers-workspace"
        className="overflow-hidden rounded-xl border bg-card/45 [contain:paint]"
      >
        <ServerToolbar
          canProvision={canProvision}
          relayConfigured={relayConfigured}
          searchStore={searchStore}
        />
        <FilteredServerTableBoundary
          canProvision={canProvision}
          relayConfigured={relayConfigured}
          searchStore={searchStore}
        />
      </section>
    </div>
  )
})

const ServerToolbar = React.memo(function ServerToolbar({
  canProvision,
  relayConfigured,
  searchStore,
}: {
  canProvision: boolean
  relayConfigured: boolean
  searchStore: ServerSearchStore
}) {
  const [mobileSearchOpen, setMobileSearchOpen] = React.useState(
    () => searchStore.getSnapshot().length > 0
  )
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const handleSearchEmpty = React.useCallback((value: string) => {
    if (value.length === 0) setMobileSearchOpen(false)
  }, [])

  React.useEffect(() => {
    if (mobileSearchOpen) searchInputRef.current?.focus()
  }, [mobileSearchOpen])

  return (
    <div className="flex min-w-0 items-center gap-2 border-b bg-background/25 p-3">
      <ServerSyncButton disabled={!relayConfigured} />

      {!mobileSearchOpen ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Search servers"
              aria-controls="server-search"
              aria-expanded={false}
              className="sm:hidden"
              onClick={() => setMobileSearchOpen(true)}
            >
              <Search />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            Search servers
          </TooltipContent>
        </Tooltip>
      ) : null}

      <div
        className={`${mobileSearchOpen ? "block" : "hidden"} min-w-0 flex-1 sm:block sm:max-w-md`}
      >
        <ServerSearchInput
          inputRef={searchInputRef}
          store={searchStore}
          onSearchEmpty={handleSearchEmpty}
        />
      </div>

      {mobileSearchOpen ? (
        <ClearMobileSearchButton
          searchStore={searchStore}
          onClose={() => setMobileSearchOpen(false)}
        />
      ) : null}

      <div
        className={`${mobileSearchOpen ? "hidden sm:flex" : "flex"} ml-auto shrink-0 items-center gap-2`}
      >
        <ActivityButton />
        <AddServerButton canProvision={canProvision} />
      </div>
    </div>
  )
})

const ServerSyncButton = React.memo(function ServerSyncButton({
  disabled,
}: {
  disabled: boolean
}) {
  const { fetchStatus, refetch } = useQuery({
    ...relaySnapshotQueryOptions(),
    enabled: !disabled,
    notifyOnChangeProps: ["fetchStatus"],
  })
  const [manualSyncing, setManualSyncing] = React.useState(false)
  const manualSyncingRef = React.useRef(false)
  const feedbackTimeoutRef = React.useRef<number>(undefined)
  const mountedRef = React.useRef(true)
  const syncing = manualSyncing || fetchStatus === "fetching"

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (feedbackTimeoutRef.current !== undefined) {
        window.clearTimeout(feedbackTimeoutRef.current)
      }
    }
  }, [])

  const syncServers = React.useCallback(() => {
    if (disabled || manualSyncingRef.current) return
    manualSyncingRef.current = true
    setManualSyncing(true)
    const startedAt = performance.now()

    void refetch().finally(() => {
      if (!mountedRef.current) return
      const elapsed = performance.now() - startedAt
      const remaining = Math.max(0, minimumManualSyncFeedbackMs - elapsed)
      feedbackTimeoutRef.current = window.setTimeout(() => {
        manualSyncingRef.current = false
        setManualSyncing(false)
        feedbackTimeoutRef.current = undefined
      }, remaining)
    })
  }, [disabled, refetch])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="Sync servers"
          aria-busy={syncing}
          disabled={disabled || syncing}
          onClick={syncServers}
        >
          <RefreshCw className={syncing ? "animate-spin" : ""} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        Sync servers
      </TooltipContent>
    </Tooltip>
  )
})

function ClearMobileSearchButton({
  searchStore,
  onClose,
}: {
  searchStore: ServerSearchStore
  onClose: () => void
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label="Close server search"
      className="sm:hidden"
      onClick={() => {
        onClose()
        searchStore.set("")
        replaceServerSearch("")
      }}
    >
      <X />
    </Button>
  )
}

const ServerSearchInput = React.memo(function ServerSearchInput({
  inputRef,
  store,
  onSearchEmpty,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  store: ServerSearchStore
  onSearchEmpty: (value: string) => void
}) {
  useWorkspaceTableSearchInput(inputRef, store)

  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        id="server-search"
        type="search"
        defaultValue={store.getServerSnapshot()}
        onChange={(event) => {
          const value = event.currentTarget.value
          store.set(value)
          onSearchEmpty(value)
          replaceServerSearch(value)
        }}
        placeholder="Search servers"
        aria-label="Search servers"
        className="pl-9 text-base md:text-sm"
      />
    </div>
  )
})

const ActivityButton = React.memo(function ActivityButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled
          aria-label="Server activity, coming soon"
          className="px-2 sm:px-2.5"
        >
          <ListTodo />
          <span className="hidden sm:inline">Activity</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        Server activity is coming soon
      </TooltipContent>
    </Tooltip>
  )
})

const AddServerButton = React.memo(function AddServerButton({
  canProvision,
}: {
  canProvision: boolean
}) {
  if (canProvision) {
    return (
      <Button asChild>
        <Link to="/bricks" preload="intent">
          <Plus /> Add Server
        </Link>
      </Button>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" disabled>
          <Plus /> Add Server
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        Server provisioning requires administrator access
      </TooltipContent>
    </Tooltip>
  )
})

const ServerTableSearchBoundary = React.memo(
  function ServerTableSearchBoundary({
    canProvision,
    searchStore,
    servers,
  }: {
    canProvision: boolean
    searchStore: ServerSearchStore
    servers: Array<ServerListInstance>
  }) {
    const shortIdCounts = React.useMemo(() => {
      const counts = new Map<string, number>()
      for (const server of servers) {
        counts.set(server.shortId, (counts.get(server.shortId) ?? 0) + 1)
      }
      return counts
    }, [servers])
    const renderRow = React.useCallback(
      (server: ServerListInstance) => (
        <ServerTableRow
          canonical={shortIdCounts.get(server.shortId) === 1}
          routeIdentifier={
            shortIdCounts.get(server.shortId) === 1
              ? server.shortId
              : server.routeId
          }
          server={server}
        />
      ),
      [shortIdCounts]
    )
    const renderEmpty = React.useCallback(
      (searchActive: boolean) => (
        <EmptyServerTable
          canProvision={canProvision}
          searchActive={searchActive}
        />
      ),
      [canProvision]
    )

    return (
      <WorkspaceDataTable
        getRowKey={serverRowKey}
        getSearchText={serverSearchText}
        head={<ServerTableHead />}
        items={servers}
        renderEmpty={renderEmpty}
        renderRow={renderRow}
        searchStore={searchStore}
      />
    )
  }
)

const FilteredServerTableBoundary = React.memo(
  function FilteredServerTableBoundary({
    canProvision,
    relayConfigured,
    searchStore,
  }: {
    canProvision: boolean
    relayConfigured: boolean
    searchStore: ServerSearchStore
  }) {
    const { data: servers = emptyServers } = useQuery({
      ...relaySnapshotQueryOptions(),
      enabled: relayConfigured,
      notifyOnChangeProps: ["data"],
      select: selectServerListInstances,
    })
    return (
      <ServerTableSearchBoundary
        canProvision={canProvision}
        searchStore={searchStore}
        servers={servers}
      />
    )
  }
)

const ServerTableHead = React.memo(function ServerTableHead() {
  return (
    <WorkspaceTableHead>
      <WorkspaceTableHeading className="w-10 px-2 sm:w-24 sm:px-3">
        <span className="sr-only sm:not-sr-only">Status</span>
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="w-auto sm:w-[25%]">
        Server
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="hidden w-[12%] lg:table-cell">
        ID
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="hidden w-[18%] lg:table-cell">
        Relay
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="hidden w-[24%] xl:table-cell">
        Address
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="hidden w-[16%] md:table-cell">
        Version
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="w-14 px-2 sm:w-24 sm:px-3">
        Open
      </WorkspaceTableHeading>
    </WorkspaceTableHead>
  )
})

const ServerTableRow = React.memo(function ServerTableRow({
  canonical,
  routeIdentifier,
  server,
}: {
  canonical: boolean
  routeIdentifier: string
  server: ServerListInstance
}) {
  return (
    <tr className="group transition-colors hover:bg-accent/25">
      <WorkspaceTableCell className="px-2 sm:px-3">
        <ServerStatus server={server} />
      </WorkspaceTableCell>
      <WorkspaceTableCell>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background/35 text-muted-foreground">
            <ServerTypeIcon
              implementation={server.implementation}
              className="size-3.5"
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0">
            <Link
              to="/server/$serverId/console"
              params={{ serverId: routeIdentifier }}
              preload="intent"
              className="block truncate text-xs font-semibold text-foreground hover:text-primary"
            >
              {server.name}
            </Link>
            <p className="truncate font-mono text-[8px] text-muted-foreground">
              {server.game} · {server.implementation}
            </p>
          </div>
        </div>
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden lg:table-cell">
        <span
          className={`font-mono text-[9px] ${canonical ? "text-foreground" : "text-amber-300"}`}
          title={
            canonical
              ? server.id
              : `${server.shortId} is shared by more than one accessible server; this row uses its Relay-qualified route`
          }
        >
          {server.shortId}
        </span>
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden lg:table-cell">
        <div className="min-w-0">
          <p className="truncate text-[10px] text-foreground">
            {server.relayName}
          </p>
          <p className="truncate font-mono text-[8px] text-muted-foreground">
            {server.relayStatus}
          </p>
        </div>
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden xl:table-cell">
        <span
          className="block truncate font-mono text-[9px] text-foreground"
          title={server.connectAddress}
        >
          {server.connectAddress}
        </span>
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden md:table-cell">
        <div className="min-w-0">
          <p className="truncate font-mono text-[9px] text-foreground">
            {server.version}
          </p>
          <p className="truncate text-[8px] text-muted-foreground">
            {server.implementation}
          </p>
        </div>
      </WorkspaceTableCell>
      <WorkspaceTableCell className="px-2 sm:px-3">
        <OpenServerButton routeIdentifier={routeIdentifier} server={server} />
      </WorkspaceTableCell>
    </tr>
  )
})

function OpenServerButton({
  routeIdentifier,
  server,
}: {
  routeIdentifier: string
  server: ServerListInstance
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          asChild
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground hover:text-primary"
        >
          <Link
            to="/server/$serverId/console"
            params={{ serverId: routeIdentifier }}
            preload="intent"
            aria-label={`Open ${server.name} console`}
          >
            <ArrowUpRight />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={6}>
        Open console
      </TooltipContent>
    </Tooltip>
  )
}

function ServerStatus({ server }: { server: ServerListInstance }) {
  const status =
    server.relayStatus === "unreachable"
      ? {
          dot: "bg-destructive",
          label: "Relay unavailable",
          text: "text-destructive",
        }
      : serverStatusTone(server.observedState)
  return (
    <span
      aria-label={status.label}
      className={`inline-flex items-center gap-1.5 text-[10px] font-medium ${status.text}`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${status.dot}`} />
      <span className="hidden sm:inline">{status.label}</span>
    </span>
  )
}

function EmptyServerTable({
  canProvision,
  searchActive,
}: {
  canProvision: boolean
  searchActive: boolean
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
      <Server className="size-6 text-muted-foreground/45" />
      <p className="mt-3 text-sm font-semibold">
        {searchActive ? "No servers match your search" : "No managed servers"}
      </p>
      <p className="mt-1 max-w-sm text-[10px] leading-4 text-muted-foreground">
        {searchActive
          ? "Try a server name, short ID, Relay, address, game, implementation, or version."
          : canProvision
            ? "Open Bricks to provision the first game server managed by Hearth."
            : "No server instances have been assigned to your account yet."}
      </p>
      {!searchActive && canProvision ? (
        <Button asChild size="sm" className="mt-4">
          <Link to="/bricks" preload="intent">
            <Plus /> Add Server
          </Link>
        </Button>
      ) : null}
    </div>
  )
}

function serverRowKey(server: ServerListInstance): string {
  return `${server.relayId}:${server.id}`
}

function serverSearchText(server: ServerListInstance): string {
  return [
    server.name,
    server.id,
    server.shortId,
    server.routeId,
    server.game,
    server.implementation,
    server.version,
    server.connectAddress,
    server.relayId,
    server.relayName,
    server.relayStatus,
    server.observedState,
  ]
    .join(" ")
    .toLowerCase()
}

function replaceServerSearch(search: string) {
  const url = new URL(window.location.href)
  if (search.length > 0) url.searchParams.set("search", search)
  else url.searchParams.delete("search")

  // TanStack patches the history instance methods so router consumers update
  // after navigation. Search typing is intentionally local to this workspace;
  // use the browser prototype method to update the current entry without
  // repainting the router's SafeFragment and CatchBoundary tree.
  History.prototype.replaceState.call(
    window.history,
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`
  )
}

function serverStatusTone(state: ServerListInstance["observedState"]) {
  if (state === "running") {
    return {
      dot: "bg-emerald-400",
      label: "Running",
      text: "text-emerald-300",
    }
  }
  if (state === "failed") {
    return {
      dot: "bg-destructive",
      label: "Failed",
      text: "text-destructive",
    }
  }
  if (state === "starting" || state === "provisioning") {
    return {
      dot: "bg-amber-400",
      label: state === "starting" ? "Starting" : "Provisioning",
      text: "text-amber-300",
    }
  }
  if (state === "stopping") {
    return {
      dot: "bg-amber-400/70",
      label: "Stopping",
      text: "text-amber-300",
    }
  }
  return {
    dot: "bg-muted-foreground/50",
    label: "Offline",
    text: "text-muted-foreground",
  }
}
