import * as React from "react"
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import {
  Check,
  CircleAlert,
  Fingerprint,
  ListTodo,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  ServerCog,
  Trash2,
  X,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { dismissToast, showToast } from "@workspace/ui/components/sonner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import {
  relayConnectionSettingsSchema,
  relayNameSchema,
  relayProxySettingsSchema,
} from "@workspace/contracts"

import { RelayToastTitle } from "@/components/relay-toast-title"
import {
  WorkspaceDataTable,
  WorkspaceTableCell,
  WorkspaceTableHead,
  WorkspaceTableHeading,
  createWorkspaceTableSearchStore,
  useWorkspaceTableSearchInput,
} from "@/components/workspace-data-table"
import type { WorkspaceTableSearchStore } from "@/components/workspace-data-table"
import type { RelayFleetSnapshot } from "@/lib/relay-fleet"
import { pairingFeedbackFrom } from "@/lib/relay-pairing-errors"
import {
  queryKeys,
  relaySnapshotQueryOptions,
  relaysQueryOptions,
} from "@/lib/query-options"
import type { PersistedRelay } from "@/lib/relay-registry"
import {
  addRelay,
  checkRelay,
  getRelayProxy,
  previewRelayPairing,
  removeRelay,
  renameRelay,
  setRelayEnabled,
  updateRelay,
  updateRelayProxy,
} from "@/server/relays"

const relayTimestampFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "long",
  timeZone: "UTC",
})
const invitationTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
})
const minimumRelaySyncFeedbackMs = 500
const pendingRelayResumes = new Map<string, Promise<void>>()

function relayProxyQueryOptions(relayId: string) {
  return queryOptions({
    queryFn: () => getRelayProxy({ data: { id: relayId } }),
    queryKey: ["relays", "proxy", relayId] as const,
    retry: false,
    staleTime: 10_000,
  })
}

interface RelayTableItem {
  hostname: string
  id: string
  name: string
  nodeArch: string | null
  nodePlatform: string | null
  nodeVersion: string | null
}

interface RelayStaticView {
  hostname: string
  name: string
  nodeArch: string | null
  nodeVersion: string | null
  port: number
  useTls: boolean
}

interface RelayStatusView {
  connected: boolean
  enabled: boolean
  lastError: string | null
}

interface RelayPauseView {
  enabled: boolean
  name: string
}

interface RelayEditView {
  enabled: boolean
  hostname: string
  id: string
  name: string
  port: number
  useTls: boolean
}

interface RelayUptimeView {
  label: string
  startedAt: string | null
}

export const AppSettingsPage = React.memo(function AppSettingsPage() {
  const [searchStore] = React.useState(createWorkspaceTableSearchStore)
  const [dialogStore] = React.useState(createRelayDialogStore)

  return (
    <div className="mx-auto w-full max-w-[90rem] px-3 pb-10 sm:px-5">
      <section className="overflow-hidden rounded-xl border bg-card/45">
        <RelayToolbar searchStore={searchStore} onAdd={dialogStore.openAdd} />

        <FilteredRelayTable
          searchStore={searchStore}
          onAdd={dialogStore.openAdd}
          onEdit={dialogStore.openEdit}
        />
      </section>

      <RelayDialogHost store={dialogStore} />
    </div>
  )
})

type RelayDialogState =
  | { kind: "add" }
  | { kind: "closed" }
  | { kind: "edit"; relayId: string }

interface RelayDialogStore {
  close: () => void
  getServerSnapshot: () => RelayDialogState
  getSnapshot: () => RelayDialogState
  openAdd: () => void
  openEdit: (relayId: string) => void
  subscribe: (listener: () => void) => () => void
}

const closedRelayDialogState: RelayDialogState = { kind: "closed" }

function createRelayDialogStore(): RelayDialogStore {
  let state = closedRelayDialogState
  const listeners = new Set<() => void>()

  function publish(nextState: RelayDialogState) {
    if (nextState === state) return
    state = nextState
    for (const listener of listeners) listener()
  }

  return {
    close: () => publish(closedRelayDialogState),
    getServerSnapshot: () => closedRelayDialogState,
    getSnapshot: () => state,
    openAdd: () => publish({ kind: "add" }),
    openEdit: (relayId) => publish({ kind: "edit", relayId }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const RelayToolbar = React.memo(function RelayToolbar({
  searchStore,
  onAdd,
}: {
  searchStore: WorkspaceTableSearchStore
  onAdd: () => void
}) {
  const [mobileSearchOpen, setMobileSearchOpen] = React.useState(false)
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (mobileSearchOpen) searchInputRef.current?.focus()
  }, [mobileSearchOpen])

  const closeMobileSearch = () => {
    searchStore.set("")
    setMobileSearchOpen(false)
  }

  return (
    <div className="flex min-w-0 items-center gap-2 border-b bg-background/25 p-3">
      <RelaySyncButton />

      {!mobileSearchOpen ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Search relays"
              aria-controls="relay-search"
              aria-expanded={false}
              className="sm:hidden"
              onClick={() => setMobileSearchOpen(true)}
            >
              <Search />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            Search relays
          </TooltipContent>
        </Tooltip>
      ) : null}

      <div
        className={`${mobileSearchOpen ? "block" : "hidden"} min-w-0 flex-1 sm:block sm:max-w-md`}
      >
        <RelaySearchInput inputRef={searchInputRef} store={searchStore} />
      </div>

      {mobileSearchOpen ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Close relay search"
          className="sm:hidden"
          onClick={closeMobileSearch}
        >
          <X />
        </Button>
      ) : null}

      <div
        className={`${mobileSearchOpen ? "hidden sm:flex" : "flex"} ml-auto shrink-0 items-center gap-2`}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="outline" className="px-2 sm:px-2.5">
              <a href="/operations" aria-label="Activity">
                <ListTodo />
                <span className="hidden sm:inline">Activity</span>
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            Activity
          </TooltipContent>
        </Tooltip>
        <RelayAddButton onAdd={onAdd} />
      </div>
    </div>
  )
})

const RelayAddButton = React.memo(function RelayAddButton({
  onAdd,
}: {
  onAdd: () => void
}) {
  return (
    <Button type="button" onClick={onAdd}>
      <Plus /> Add Relay
    </Button>
  )
})

const RelayDialogHost = React.memo(function RelayDialogHost({
  store,
}: {
  store: RelayDialogStore
}) {
  const state = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot
  )
  const selectEditingRelay = React.useCallback(
    (relays: Array<PersistedRelay>): RelayEditView | null => {
      if (state.kind !== "edit") return null
      const relay = relays.find((item) => item.id === state.relayId)
      return relay
        ? {
            enabled: relay.enabled,
            hostname: relay.hostname,
            id: relay.id,
            name: relay.name,
            port: relay.port,
            useTls: relay.useTls,
          }
        : null
    },
    [state]
  )
  const { data: editingRelay } = useSuspenseQuery({
    ...relaysQueryOptions(),
    select: selectEditingRelay,
  })

  return (
    <>
      <AddRelayDialog
        open={state.kind === "add"}
        onOpenChange={(open) => {
          if (!open) store.close()
        }}
      />
      {editingRelay ? (
        <EditRelayDialog
          key={editingRelay.id}
          relay={editingRelay}
          open
          onOpenChange={(open) => {
            if (!open) store.close()
          }}
        />
      ) : null}
    </>
  )
})

const RelaySearchInput = React.memo(function RelaySearchInput({
  inputRef,
  store,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  store: WorkspaceTableSearchStore
}) {
  useWorkspaceTableSearchInput(inputRef, store)

  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        id="relay-search"
        type="search"
        defaultValue={store.getServerSnapshot()}
        onChange={(event) => store.set(event.currentTarget.value)}
        placeholder="Search relays"
        aria-label="Search relays"
        className="pl-9 text-base md:text-sm"
      />
    </div>
  )
})

const FilteredRelayTable = React.memo(function FilteredRelayTable({
  searchStore,
  onAdd,
  onEdit,
}: {
  searchStore: WorkspaceTableSearchStore
  onAdd: () => void
  onEdit: (relayId: string) => void
}) {
  const { data: relays } = useSuspenseQuery({
    ...relaysQueryOptions(),
    select: selectRelayTableItems,
  })

  return (
    <RelayTable
      relays={relays}
      searchStore={searchStore}
      onAdd={onAdd}
      onEdit={onEdit}
    />
  )
})

const RelaySyncButton = React.memo(function RelaySyncButton() {
  const queryClient = useQueryClient()
  const [manualSyncing, setManualSyncing] = React.useState(false)
  const manualSyncingRef = React.useRef(false)
  const feedbackTimeoutRef = React.useRef<number>(undefined)
  const mountedRef = React.useRef(true)
  const { data: hasEnabledRelay } = useSuspenseQuery({
    ...relaysQueryOptions(),
    select: selectHasEnabledRelay,
  })
  const syncRelays = useMutation({
    mutationFn: async () => {
      const relays =
        queryClient.getQueryData<Array<PersistedRelay>>(queryKeys.relays) ?? []
      const checks: Array<ReturnType<typeof checkRelay>> = []
      for (const relay of relays) {
        if (relay.enabled) checks.push(checkRelay({ data: { id: relay.id } }))
      }
      const checkedRelays = await Promise.all(checks)
      updateRelayCache(queryClient, checkedRelays)
    },
    onError: (cause) => showRelayError(cause, "Could not sync Relays"),
  })
  const syncing = manualSyncing || syncRelays.isPending

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (feedbackTimeoutRef.current !== undefined) {
        window.clearTimeout(feedbackTimeoutRef.current)
      }
    }
  }, [])

  const sync = React.useCallback(() => {
    if (!hasEnabledRelay || manualSyncingRef.current) return
    manualSyncingRef.current = true
    setManualSyncing(true)
    const startedAt = performance.now()

    syncRelays.mutate(undefined, {
      onSettled: () => {
        if (!mountedRef.current) return
        const elapsed = performance.now() - startedAt
        const remaining = Math.max(0, minimumRelaySyncFeedbackMs - elapsed)
        feedbackTimeoutRef.current = window.setTimeout(() => {
          manualSyncingRef.current = false
          setManualSyncing(false)
          feedbackTimeoutRef.current = undefined
        }, remaining)
      },
    })
  }, [hasEnabledRelay, syncRelays])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="Sync relays"
          aria-busy={syncing}
          disabled={syncing || !hasEnabledRelay}
          onClick={sync}
        >
          <RefreshCw className={syncing ? "animate-spin" : ""} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        Sync relays
      </TooltipContent>
    </Tooltip>
  )
})

function RelayTable({
  relays,
  searchStore,
  onAdd,
  onEdit,
}: {
  relays: Array<RelayTableItem>
  searchStore: WorkspaceTableSearchStore
  onAdd: () => void
  onEdit: (relayId: string) => void
}) {
  const renderRow = React.useCallback(
    (relay: RelayTableItem) => (
      <RelayTableRow relayId={relay.id} onEdit={onEdit} />
    ),
    [onEdit]
  )
  const renderEmpty = React.useCallback(
    (searchActive: boolean) => (
      <EmptyRelayTable searchActive={searchActive} onAdd={onAdd} />
    ),
    [onAdd]
  )

  return (
    <WorkspaceDataTable
      getRowKey={relayRowKey}
      getSearchText={relaySearchText}
      head={<RelayTableHead />}
      items={relays}
      renderEmpty={renderEmpty}
      renderRow={renderRow}
      searchStore={searchStore}
    />
  )
}

const RelayTableHead = React.memo(function RelayTableHead() {
  return (
    <WorkspaceTableHead>
      <WorkspaceTableHeading className="w-10 px-2 sm:w-24 sm:px-3">
        <span className="sr-only sm:not-sr-only">Status</span>
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="sm:w-[16%]">
        Relay
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="hidden w-[10%] xl:table-cell">
        ID
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="hidden w-[18%] lg:table-cell">
        Host
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="hidden w-[12%] lg:table-cell">
        Version
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="hidden w-[8%] xl:table-cell">
        Arch
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="hidden w-24 sm:table-cell">
        Uptime
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="w-[6.5rem] px-1 sm:w-28 sm:px-3">
        Actions
      </WorkspaceTableHeading>
    </WorkspaceTableHead>
  )
})

const RelayTableRow = React.memo(function RelayTableRow({
  relayId,
  onEdit,
}: {
  relayId: string
  onEdit: (relayId: string) => void
}) {
  return (
    <tr className="group transition-colors hover:bg-accent/25">
      <WorkspaceTableCell className="px-2 sm:px-3">
        <RelayStatus relayId={relayId} />
      </WorkspaceTableCell>
      <RelayStaticCells relayId={relayId} />
      <WorkspaceTableCell className="hidden font-mono text-[9px] whitespace-nowrap text-foreground sm:table-cell">
        <RelayUptime relayId={relayId} />
      </WorkspaceTableCell>
      <WorkspaceTableCell className="px-1 sm:px-3 sm:pr-3">
        <div className="flex items-center justify-end gap-1">
          <RelayEditButton relayId={relayId} onEdit={onEdit} />
          <RelayPauseButton relayId={relayId} />
          <RelayDeleteButton relayId={relayId} />
        </div>
      </WorkspaceTableCell>
    </tr>
  )
})

const RelayStaticCells = React.memo(function RelayStaticCells({
  relayId,
}: {
  relayId: string
}) {
  const selectRelay = React.useCallback(
    (relays: Array<PersistedRelay>): RelayStaticView | null => {
      const relay = relays.find((item) => item.id === relayId)
      return relay
        ? {
            hostname: relay.hostname,
            name: relay.name,
            nodeArch: relay.nodeArch,
            nodeVersion: relay.nodeVersion,
            port: relay.port,
            useTls: relay.useTls,
          }
        : null
    },
    [relayId]
  )
  const { data: relay } = useQuery({
    ...relaysQueryOptions(),
    notifyOnChangeProps: ["data"],
    select: selectRelay,
  })

  if (!relay) return null
  return (
    <>
      <WorkspaceTableCell>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-foreground">
            {relay.name}
          </p>
          <p className="truncate font-mono text-[8px] text-foreground lg:hidden">
            {relay.hostname}
          </p>
        </div>
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden xl:table-cell">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="inline-block cursor-default font-mono text-[9px] text-foreground outline-none"
            >
              {shortRelayId(relayId)}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6} className="font-mono">
            {relayId}
          </TooltipContent>
        </Tooltip>
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden lg:table-cell">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="block min-w-0 cursor-default truncate font-mono text-[9px] text-foreground outline-none"
            >
              {relay.hostname}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6} className="font-mono">
            {relay.useTls ? "https" : "http"}://{relay.hostname}:{relay.port}
          </TooltipContent>
        </Tooltip>
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden lg:table-cell">
        <span className="block truncate font-mono text-[9px] text-foreground">
          {relay.nodeVersion ?? "—"}
        </span>
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden xl:table-cell">
        <span className="font-mono text-[9px] text-foreground">
          {relay.nodeArch ?? "—"}
        </span>
      </WorkspaceTableCell>
    </>
  )
})

const RelayEditButton = React.memo(function RelayEditButton({
  relayId,
  onEdit,
}: {
  relayId: string
  onEdit: (relayId: string) => void
}) {
  const queryClient = useQueryClient()
  const selectName = React.useCallback(
    (relays: Array<PersistedRelay>) =>
      relays.find((relay) => relay.id === relayId)?.name ?? "Relay",
    [relayId]
  )
  const { data: name = "Relay" } = useQuery({
    ...relaysQueryOptions(),
    notifyOnChangeProps: ["data"],
    select: selectName,
  })
  const warmProxy = React.useCallback(() => {
    const relay = queryClient
      .getQueryData<Array<PersistedRelay>>(queryKeys.relays)
      ?.find((item) => item.id === relayId)
    if (!relay?.enabled) return
    void queryClient.prefetchQuery(relayProxyQueryOptions(relayId))
  }, [queryClient, relayId])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Edit ${name}`}
          className="text-muted-foreground hover:text-foreground"
          onFocus={warmProxy}
          onPointerEnter={warmProxy}
          onClick={() => onEdit(relayId)}
        >
          <Pencil />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        Edit
      </TooltipContent>
    </Tooltip>
  )
})

const RelayPauseButton = React.memo(function RelayPauseButton({
  relayId,
}: {
  relayId: string
}) {
  const queryClient = useQueryClient()
  const pendingRef = React.useRef(false)
  const [pending, setPending] = React.useState(false)
  const selectRelay = React.useCallback(
    (relays: Array<PersistedRelay>): RelayPauseView | null => {
      const relay = relays.find((item) => item.id === relayId)
      return relay ? { enabled: relay.enabled, name: relay.name } : null
    },
    [relayId]
  )
  const { data: relay } = useQuery({
    ...relaysQueryOptions(),
    notifyOnChangeProps: ["data"],
    select: selectRelay,
  })

  async function togglePaused() {
    if (!relay || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    const relayIdentity = { id: relayId, name: relay.name }
    try {
      if (relay.enabled) await pauseRelay(queryClient, relayIdentity)
      else await resumeRelay(queryClient, relayIdentity)
    } catch (cause) {
      showRelayError(
        cause,
        relay.enabled ? "Could not pause Relay" : "Could not resume Relay"
      )
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  if (!relay) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`${relay.enabled ? "Pause" : "Resume"} ${relay.name}`}
          disabled={pending}
          className="text-muted-foreground hover:text-foreground"
          onClick={() => void togglePaused()}
        >
          {pending ? (
            <LoaderCircle className="animate-spin" />
          ) : relay.enabled ? (
            <Pause />
          ) : (
            <Play />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {relay.enabled ? "Pause" : "Resume"}
      </TooltipContent>
    </Tooltip>
  )
})

const RelayDeleteButton = React.memo(function RelayDeleteButton({
  relayId,
}: {
  relayId: string
}) {
  const queryClient = useQueryClient()
  const pendingRef = React.useRef(false)
  const [pending, setPending] = React.useState(false)
  const selectName = React.useCallback(
    (relays: Array<PersistedRelay>) =>
      relays.find((relay) => relay.id === relayId)?.name ?? "Relay",
    [relayId]
  )
  const { data: name = "Relay" } = useQuery({
    ...relaysQueryOptions(),
    notifyOnChangeProps: ["data"],
    select: selectName,
  })
  const removeMutation = useMutation({
    mutationFn: removeRelay,
    onSuccess: async () => {
      queryClient.setQueryData<Array<PersistedRelay>>(
        queryKeys.relays,
        (current) => current?.filter((item) => item.id !== relayId)
      )
      await invalidateRelayRuntimeQueries(queryClient)
    },
  })

  async function remove() {
    if (pendingRef.current) return
    if (!window.confirm(`Remove ${name} from Hearth?`)) return
    pendingRef.current = true
    setPending(true)
    try {
      await removeMutation.mutateAsync({ data: { id: relayId } })
      dismissToast(relayPausedToastId(relayId))
      dismissToast(relayResumedToastId(relayId))
      dismissToast(relayResumeErrorToastId(relayId))
    } catch (cause) {
      showRelayError(cause, "Could not remove Relay")
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Delete ${name}`}
          disabled={pending}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={() => void remove()}
        >
          {pending ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        Delete
      </TooltipContent>
    </Tooltip>
  )
})

const RelayStatus = React.memo(function RelayStatus({
  relayId,
}: {
  relayId: string
}) {
  const selectStatus = React.useCallback(
    (relays: Array<PersistedRelay>): RelayStatusView | null => {
      const relay = relays.find((item) => item.id === relayId)
      return relay
        ? {
            connected: relay.lastConnectedAt !== null,
            enabled: relay.enabled,
            lastError: relay.lastError,
          }
        : null
    },
    [relayId]
  )
  const { data: relay } = useQuery({
    ...relaysQueryOptions(),
    notifyOnChangeProps: ["data"],
    select: selectStatus,
  })
  if (!relay) return null

  const status = !relay.enabled
    ? { label: "Paused", dot: "bg-sky-400", text: "text-sky-300" }
    : relay.lastError
      ? {
          label: "Unreachable",
          dot: "bg-destructive",
          text: "text-destructive",
        }
      : relay.connected
        ? { label: "Online", dot: "bg-emerald-400", text: "text-emerald-300" }
        : {
            label: "Offline",
            dot: "bg-muted-foreground/50",
            text: "text-muted-foreground",
          }
  const indicator = (
    <span
      aria-label={status.label}
      className={`inline-flex items-center gap-1.5 text-[10px] font-medium ${status.text}`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${status.dot}`} />
      <span className="hidden sm:inline">{status.label}</span>
    </span>
  )
  if (!relay.lastError) return indicator
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="cursor-default outline-none">
          {indicator}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        <span className="max-w-64 text-muted-foreground">
          {relay.lastError}
        </span>
      </TooltipContent>
    </Tooltip>
  )
})

const RelayUptime = React.memo(function RelayUptime({
  relayId,
}: {
  relayId: string
}) {
  const lastStartedAtRef = React.useRef<string | null>(null)
  const selectUptime = React.useCallback(
    (snapshot: RelayFleetSnapshot): RelayUptimeView => {
      const node = snapshot.nodes.find((item) => item.relayId === relayId)
      const startedAt = node?.startedAt ?? node?.connectedAt ?? null
      if (startedAt) lastStartedAtRef.current = startedAt
      return {
        label: formatUptimeSince(lastStartedAtRef.current),
        startedAt: lastStartedAtRef.current,
      }
    },
    [relayId]
  )
  const { data } = useQuery({
    ...relaySnapshotQueryOptions(),
    notifyOnChangeProps: ["data"],
    retry: false,
    select: selectUptime,
  })
  const startedAt = data?.startedAt ?? null
  const uptime = data?.label ?? "—"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="cursor-default outline-none focus-visible:text-foreground"
        >
          {uptime}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={6}
        className="grid min-w-64 gap-2.5"
      >
        <RelayUptimeDetails relayId={relayId} startedAt={startedAt} />
      </TooltipContent>
    </Tooltip>
  )
})

const RelayUptimeDetails = React.memo(function RelayUptimeDetails({
  relayId,
  startedAt,
}: {
  relayId: string
  startedAt: string | null
}) {
  const selectConnectedAt = React.useCallback(
    (relays: Array<PersistedRelay>) => {
      const relay = relays.find((item) => item.id === relayId)
      return relay?.lastConnectedAt ?? relay?.createdAt ?? null
    },
    [relayId]
  )
  const { data: connectedAt = null } = useQuery({
    ...relaysQueryOptions(),
    notifyOnChangeProps: ["data"],
    select: selectConnectedAt,
  })
  return (
    <>
      <TooltipDetail
        label="Connected at"
        value={
          connectedAt
            ? relayTimestampFormatter.format(new Date(connectedAt))
            : "Unavailable"
        }
      />
      <TooltipDetail
        label="Relay started at"
        value={
          startedAt
            ? relayTimestampFormatter.format(new Date(startedAt))
            : "Unavailable"
        }
      />
    </>
  )
})

function TooltipDetail({ label, value }: { label: string; value: string }) {
  return (
    <span className="grid gap-0.5">
      <span className="font-mono text-[8px] tracking-[0.12em] text-primary uppercase">
        {label}
      </span>
      <span className="text-[10px] text-foreground">{value}</span>
    </span>
  )
}

function EmptyRelayTable({
  searchActive,
  onAdd,
}: {
  searchActive: boolean
  onAdd: () => void
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
      <ServerCog className="size-6 text-muted-foreground/45" />
      <p className="mt-3 text-sm font-semibold">
        {searchActive ? "No relays match your search" : "No saved Relays"}
      </p>
      <p className="mt-1 max-w-sm text-[10px] leading-4 text-muted-foreground">
        {searchActive
          ? "Try a relay name, ID, hostname, architecture, or version."
          : "Pair the first Relay to start managing game servers from Hearth."}
      </p>
      {!searchActive ? (
        <Button type="button" size="sm" className="mt-4" onClick={onAdd}>
          <Plus /> Add Relay
        </Button>
      ) : null}
    </div>
  )
}

function AddRelayDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const formRef = React.useRef<HTMLFormElement>(null)
  const [pending, setPending] = React.useState(false)
  const [feedback, setFeedback] = React.useState<{
    docsHref?: string
    message: string
  } | null>(null)
  const [reviewedPairing, setReviewedPairing] = React.useState<{
    pairingUri: string
    preview: {
      controlEndpoint: string
      existingRelayName: string | null
      expiresAt: number
      managedTls: boolean
      mode: "add" | "repair"
      relayFingerprint: string
      relayName: string
    }
  } | null>(null)
  const addMutation = useMutation({
    mutationFn: addRelay,
    onSuccess: async (relay) => {
      queryClient.setQueryData<Array<PersistedRelay>>(
        queryKeys.relays,
        (current) =>
          current?.some((item) => item.id === relay.id)
            ? current.map((item) => (item.id === relay.id ? relay : item))
            : [...(current ?? []), relay]
      )
      await invalidateRelayRuntimeQueries(queryClient)
    },
  })

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen && pending) return
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setFeedback(null)
      setReviewedPairing(null)
      formRef.current?.reset()
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFeedback(null)
    try {
      if (!reviewedPairing) {
        const form = new FormData(event.currentTarget)
        const pairingUri = String(form.get("pairingUri") ?? "").trim()
        const preview = await previewRelayPairing({ data: { pairingUri } })
        setReviewedPairing({ pairingUri, preview })
        return
      }
      const relay = await addMutation.mutateAsync({
        data: { pairingUri: reviewedPairing.pairingUri },
      })
      const repaired = reviewedPairing.preview.mode === "repair"
      showToast({
        type: "success",
        message: repaired ? `${relay.name} repaired` : `${relay.name} paired`,
        description: repaired
          ? "The Relay connection was repaired without replacing its Hearth data."
          : "The Relay is now available to Hearth.",
        duration: 4_000,
      })
      onOpenChange(false)
      setFeedback(null)
      setReviewedPairing(null)
      formRef.current?.reset()
    } catch (cause) {
      setFeedback(pairingFeedbackFrom(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <p className="font-mono text-[9px] tracking-[0.16em] text-primary uppercase">
            {reviewedPairing?.preview.mode === "repair"
              ? "Existing connection"
              : "New connection"}
          </p>
          <DialogTitle>
            {reviewedPairing?.preview.mode === "repair"
              ? "Repair Relay connection"
              : "Add a Relay"}
          </DialogTitle>
          <DialogDescription>
            {reviewedPairing?.preview.mode === "repair"
              ? "Verify the Relay identity before authorizing it again."
              : "Paste the one-time pairing URI printed by Relay, then verify its identity before connecting."}
          </DialogDescription>
        </DialogHeader>

        <form
          ref={formRef}
          className="space-y-4"
          onSubmit={(event) => void submit(event)}
        >
          {reviewedPairing ? (
            <PairingReview
              pairing={reviewedPairing.preview}
              onBack={() => {
                setFeedback(null)
                setReviewedPairing(null)
              }}
            />
          ) : (
            <>
              <Field
                label="Create a pairing URI"
                htmlFor="relay-pairing-command"
              >
                <Input
                  id="relay-pairing-command"
                  value="docker exec <container-id> kiln-relay pair create"
                  className="font-mono text-[9px]"
                  readOnly
                />
                <p className="text-[9px] leading-4 text-muted-foreground">
                  Run this against your Relay container, then paste the returned
                  URI below.
                </p>
              </Field>

              <Field label="One-time pairing URI" htmlFor="relay-pairing-uri">
                <textarea
                  id="relay-pairing-uri"
                  name="pairingUri"
                  className="min-h-32 w-full resize-y rounded-md border border-input bg-background/35 px-3 py-2 font-mono text-[10px] leading-5 shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                  placeholder="kiln-relay://pair/v1?payload=…"
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </Field>
            </>
          )}

          {feedback ? (
            <DialogFeedback
              message={feedback.message}
              docsHref={feedback.docsHref}
            />
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => changeOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" /> : <Check />}
              {reviewedPairing?.preview.mode === "repair"
                ? "Repair connection"
                : reviewedPairing
                  ? "Confirm and pair"
                  : "Review pairing"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PairingReview({
  pairing,
  onBack,
}: {
  pairing: {
    controlEndpoint: string
    existingRelayName: string | null
    expiresAt: number
    managedTls: boolean
    mode: "add" | "repair"
    relayFingerprint: string
    relayName: string
  }
  onBack: () => void
}) {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/[0.045] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
            <Fingerprint className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[9px] tracking-[0.12em] text-primary uppercase">
              Verify identity
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold">
              {pairing.relayName}
            </p>
          </div>
        </div>
        <Button type="button" size="xs" variant="ghost" onClick={onBack}>
          <X /> Back
        </Button>
      </div>
      {pairing.mode === "repair" ? (
        <div className="mt-4 flex gap-2.5 rounded-md border border-primary/20 bg-background/55 p-3">
          <RefreshCw className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <div>
            <p className="text-[10px] font-medium text-foreground">
              Existing Relay identity found
            </p>
            <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
              Hearth will repair{" "}
              <span className="font-medium text-foreground">
                {pairing.existingRelayName ?? pairing.relayName}
              </span>{" "}
              in place. Server records, file activity, pins, and access stay
              attached.
            </p>
          </div>
        </div>
      ) : null}
      <dl className="mt-4 grid gap-3 text-[10px] sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Relay fingerprint</dt>
          <dd className="mt-1 font-mono break-all text-foreground">
            {pairing.relayFingerprint}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Control endpoint</dt>
          <dd className="mt-1 font-mono break-all text-foreground">
            {pairing.controlEndpoint}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">TLS trust</dt>
          <dd className="mt-1 text-foreground">
            {pairing.managedTls ? "Relay-managed CA" : "System trust"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Invitation expires</dt>
          <dd className="mt-1 text-foreground">
            {invitationTimeFormatter.format(new Date(pairing.expiresAt))}
          </dd>
        </div>
      </dl>
    </div>
  )
}

function EditRelayDialog({
  relay,
  open,
  onOpenChange,
}: {
  relay: RelayEditView
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [pending, setPending] = React.useState(false)
  const [feedback, setFeedback] = React.useState<string | null>(null)
  const updateConnection = useMutation({
    mutationFn: updateRelay,
    onSuccess: async (updatedRelay) => {
      updateRelayCache(queryClient, [updatedRelay])
      await invalidateRelayRuntimeQueries(queryClient)
    },
  })
  const updateName = useMutation({
    mutationFn: renameRelay,
    onSuccess: (updatedRelay) => updateRelayCache(queryClient, [updatedRelay]),
  })
  const updateProxy = useMutation({
    mutationFn: updateRelayProxy,
    onSuccess: (result) =>
      queryClient.setQueryData(
        relayProxyQueryOptions(relay.id).queryKey,
        result
      ),
  })

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setFeedback(null)

    // These values live in separate Hearth and Relay stores, so validate the
    // complete form before starting the intentionally sequential updates.
    const parsedName = relayNameSchema.safeParse(form.get("name"))
    if (!parsedName.success) {
      setFeedback(parsedName.error.issues[0]?.message ?? "Enter a Relay name")
      return
    }
    const parsedConnection = relayConnectionSettingsSchema.safeParse({
      hostname: form.get("hostname"),
      port: Number(form.get("port")),
      useTls: relay.useTls,
    })
    if (!parsedConnection.success) {
      setFeedback(
        parsedConnection.error.issues[0]?.message ??
          "Enter valid connection settings"
      )
      return
    }
    const proxy = relay.enabled
      ? queryClient.getQueryData(relayProxyQueryOptions(relay.id).queryKey)
      : undefined
    if (relay.enabled && !proxy) {
      setFeedback("Proxy configuration is still loading. Try again shortly.")
      return
    }
    const parsedProxy =
      relay.enabled && proxy
        ? relayProxySettingsSchema.safeParse({
            acmeEmail: proxy.settings.acmeEmail,
            mode: relayProxyMode(form.get("mode")),
            traefikImage: form.get("traefikImage"),
          })
        : null
    if (parsedProxy && !parsedProxy.success) {
      setFeedback(
        parsedProxy.error.issues[0]?.message ?? "Enter valid proxy settings"
      )
      return
    }

    setPending(true)
    try {
      if (parsedName.data !== relay.name) {
        await updateName.mutateAsync({
          data: { name: parsedName.data, relayId: relay.id },
        })
      }
      await updateConnection.mutateAsync({
        data: {
          id: relay.id,
          ...parsedConnection.data,
        },
      })
      if (parsedProxy?.success) {
        await updateProxy.mutateAsync({
          data: {
            relayId: relay.id,
            ...parsedProxy.data,
          },
        })
      }
      showToast({
        type: "success",
        message: `${parsedName.data} updated`,
        description: "Relay connection settings were saved.",
        duration: 4_000,
      })
      onOpenChange(false)
    } catch (cause) {
      setFeedback(messageFrom(cause, "Could not update Relay"))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !pending && onOpenChange(nextOpen)}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <p className="font-mono text-[9px] tracking-[0.16em] text-primary uppercase">
            Edit connection
          </p>
          <DialogTitle>{relay.name}</DialogTitle>
          <DialogDescription>
            Update the Relay identity, control endpoint, and edge proxy
            configuration.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <div className="rounded-md border border-border/70 bg-background/35 px-3 py-2 font-mono text-[9px] text-muted-foreground">
            Relay ID <span className="ml-1 text-foreground/85">{relay.id}</span>
          </div>

          <Field label="Relay name" htmlFor={`relay-name-${relay.id}`}>
            <Input
              id={`relay-name-${relay.id}`}
              name="name"
              defaultValue={relay.name}
              maxLength={120}
              required
            />
          </Field>

          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <Field label="Hostname" htmlFor={`relay-hostname-${relay.id}`}>
              <Input
                id={`relay-hostname-${relay.id}`}
                name="hostname"
                defaultValue={relay.hostname}
                placeholder="relay.example.com"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            </Field>
            <Field label="Port" htmlFor={`relay-port-${relay.id}`}>
              <Input
                id={`relay-port-${relay.id}`}
                name="port"
                defaultValue={String(relay.port)}
                type="number"
                min={1}
                max={65_535}
                required
              />
            </Field>
          </div>

          <div className="border-t border-border/70 pt-4">
            <p className="mb-3 font-mono text-[9px] tracking-[0.14em] text-primary uppercase">
              Proxy
            </p>
            <RelayProxyFields relayEnabled={relay.enabled} relayId={relay.id} />
          </div>

          {feedback ? <DialogFeedback message={feedback} /> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <RelayEditSubmitButton
              pending={pending}
              relayEnabled={relay.enabled}
              relayId={relay.id}
            />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const RelayProxyFields = React.memo(function RelayProxyFields({
  relayEnabled,
  relayId,
}: {
  relayEnabled: boolean
  relayId: string
}) {
  const proxy = useQuery({
    ...relayProxyQueryOptions(relayId),
    enabled: relayEnabled,
  })

  if (relayEnabled && proxy.isPending) {
    return (
      <div className="flex h-20 items-center justify-center gap-2 rounded-md border border-border/70 bg-background/25 text-[10px] text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" /> Reading proxy
        configuration…
      </div>
    )
  }
  if (relayEnabled && proxy.error) {
    return (
      <DialogFeedback
        message={messageFrom(proxy.error, "Could not read proxy configuration")}
      />
    )
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Proxy mode" htmlFor={`relay-proxy-mode-${relayId}`}>
          <select
            id={`relay-proxy-mode-${relayId}`}
            name="mode"
            defaultValue={proxy.data?.settings.mode ?? "none"}
            disabled={!relayEnabled}
            className="h-8 w-full rounded-md border border-input bg-background/35 px-2 text-[10px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
          >
            <option value="none">None / existing Traefik</option>
            <option value="hearth">Hearth proxy</option>
            <option value="traefik">Bundled Traefik</option>
            <option value="coolify">Coolify Traefik</option>
          </select>
        </Field>
        <Field label="Traefik image" htmlFor={`traefik-image-${relayId}`}>
          <Input
            id={`traefik-image-${relayId}`}
            name="traefikImage"
            defaultValue={proxy.data?.settings.traefikImage ?? ""}
            placeholder="traefik:v3.6"
            disabled={!relayEnabled}
            required={relayEnabled}
          />
        </Field>
      </div>
      {!relayEnabled ? (
        <p className="mt-2 text-[10px] text-sky-300/80">
          Resume this Relay to edit its proxy configuration.
        </p>
      ) : null}
    </>
  )
})

const RelayEditSubmitButton = React.memo(function RelayEditSubmitButton({
  pending,
  relayEnabled,
  relayId,
}: {
  pending: boolean
  relayEnabled: boolean
  relayId: string
}) {
  const proxy = useQuery({
    ...relayProxyQueryOptions(relayId),
    enabled: relayEnabled,
    notifyOnChangeProps: ["data", "error", "isPending"],
  })

  return (
    <Button
      type="submit"
      disabled={
        pending || (relayEnabled && (proxy.isPending || Boolean(proxy.error)))
      }
    >
      {pending ? <LoaderCircle className="animate-spin" /> : <Check />}
      Save changes
    </Button>
  )
})

function DialogFeedback({
  docsHref,
  message,
}: {
  docsHref?: string
  message: string
}) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-[10px] leading-4 text-destructive"
    >
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 space-y-1">
        <p>{message}</p>
        {docsHref ? (
          <a
            href={docsHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex font-medium underline underline-offset-2 hover:text-destructive/80"
          >
            Docs
          </a>
        ) : null}
      </div>
    </div>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-[10px] font-medium text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  )
}

function selectRelayTableItems(
  relays: Array<PersistedRelay>
): Array<RelayTableItem> {
  return relays.map((relay) => ({
    hostname: relay.hostname,
    id: relay.id,
    name: relay.name,
    nodeArch: relay.nodeArch,
    nodePlatform: relay.nodePlatform,
    nodeVersion: relay.nodeVersion,
  }))
}

function selectHasEnabledRelay(relays: Array<PersistedRelay>): boolean {
  return relays.some((relay) => relay.enabled)
}

function relaySearchText(relay: RelayTableItem): string {
  return [
    relay.name,
    relay.id,
    relay.hostname,
    relay.nodeArch ?? "",
    relay.nodePlatform ?? "",
    relay.nodeVersion ?? "",
  ]
    .join(" ")
    .toLowerCase()
}

function relayRowKey(relay: RelayTableItem): string {
  return relay.id
}

function shortRelayId(id: string): string {
  return id.slice(0, 7)
}

function formatUptime(seconds: number | null): string {
  if (seconds === null) return "—"
  if (seconds < 60) return `${Math.floor(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function formatUptimeSince(startedAt: string | null): string {
  if (!startedAt) return "—"
  const timestamp = Date.parse(startedAt)
  if (!Number.isFinite(timestamp)) return "—"
  return formatUptime(Math.max(0, Math.floor((Date.now() - timestamp) / 1_000)))
}

function relayProxyMode(value: FormDataEntryValue | null) {
  if (value === "coolify") return "coolify"
  if (value === "traefik") return "traefik"
  if (value === "hearth") return "hearth"
  return "none"
}

function updateRelayCache(
  queryClient: QueryClient,
  updatedRelays: Array<PersistedRelay>
) {
  if (updatedRelays.length === 0) return
  const updates = new Map(updatedRelays.map((relay) => [relay.id, relay]))
  queryClient.setQueryData<Array<PersistedRelay>>(
    queryKeys.relays,
    (current) =>
      current?.map((relay) => updates.get(relay.id) ?? relay) ?? updatedRelays
  )
}

async function invalidateRelayRuntimeQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.relay.connection,
      exact: true,
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.relay.snapshot,
      exact: true,
    }),
  ])
}

async function pauseRelay(
  queryClient: QueryClient,
  relay: Pick<PersistedRelay, "id" | "name">
): Promise<void> {
  await queryClient.cancelQueries({
    predicate: ({ queryKey }) =>
      queryKey[0] === queryKeys.relay.all[0] &&
      (queryKey[1] === queryKeys.relay.connection[1] ||
        queryKey[1] === queryKeys.relay.snapshot[1] ||
        queryKey[1] === relay.id),
  })
  const updatedRelay = await setRelayEnabled({
    data: { enabled: false, id: relay.id },
  })
  updateRelayCache(queryClient, [updatedRelay])
  await invalidateRelayRuntimeQueries(queryClient)
  dismissToast(relayResumedToastId(relay.id))
  showPausedRelayToast(queryClient, relay)
}

async function resumeRelay(
  queryClient: QueryClient,
  relay: Pick<PersistedRelay, "id" | "name">
): Promise<void> {
  const existing = pendingRelayResumes.get(relay.id)
  if (existing) return existing
  dismissToast(relayResumeErrorToastId(relay.id))
  const pending = performRelayResume(queryClient, relay)
  pendingRelayResumes.set(relay.id, pending)
  try {
    await pending
  } finally {
    if (pendingRelayResumes.get(relay.id) === pending)
      pendingRelayResumes.delete(relay.id)
  }
}

async function performRelayResume(
  queryClient: QueryClient,
  relay: Pick<PersistedRelay, "id" | "name">
): Promise<void> {
  const updatedRelay = await setRelayEnabled({
    data: { enabled: true, id: relay.id },
  })
  updateRelayCache(queryClient, [updatedRelay])
  await invalidateRelayRuntimeQueries(queryClient)
  dismissToast(relayPausedToastId(relay.id))
  dismissToast(relayResumeErrorToastId(relay.id))
  showToast({
    type: "success",
    message: <RelayToastTitle name={relay.name} state="resumed" />,
    id: relayResumedToastId(relay.id),
    icon: <Play className="size-4 text-emerald-400" />,
    description: "Hearth has resumed requesting Relay data.",
    duration: 4_000,
  })
}

function showPausedRelayToast(
  queryClient: QueryClient,
  relay: Pick<PersistedRelay, "id" | "name">
): void {
  showToast({
    type: "info",
    message: <RelayToastTitle name={relay.name} state="paused" />,
    id: relayPausedToastId(relay.id),
    icon: <Pause className="size-4 text-sky-400" />,
    description: "Hearth stopped requesting data. The Relay remains online.",
    duration: Infinity,
    action: {
      label: "Reconnect",
      onClick: (event) => {
        event.preventDefault()
        void resumeRelay(queryClient, relay).catch((cause: unknown) => {
          showToast({
            type: "error",
            message: (
              <RelayToastTitle name={relay.name} state="could not be resumed" />
            ),
            id: relayResumeErrorToastId(relay.id),
            description: messageFrom(cause, "Try reconnecting again."),
            duration: 6_000,
          })
        })
      },
    },
  })
}

function showRelayError(cause: unknown, fallback: string) {
  showToast({
    type: "error",
    message: fallback,
    description: messageFrom(cause, fallback),
    duration: 6_000,
  })
}

function relayPausedToastId(relayId: string): string {
  return `relay-paused:${relayId}`
}

function relayResumedToastId(relayId: string): string {
  return `relay-resumed:${relayId}`
}

function relayResumeErrorToastId(relayId: string): string {
  return `relay-resume-error:${relayId}`
}

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
