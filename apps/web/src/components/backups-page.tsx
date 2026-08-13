import * as React from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { ensuringPromise, forkPromise } from "@/effect/promise"
import { Link } from "@tanstack/react-router"
import {
  Archive,
  ArrowLeft,
  Check,
  Cloud,
  CloudCog,
  Copy,
  Database,
  Download,
  HardDrive,
  History as RotateCcwClock,
  LoaderCircle,
  ExternalLink,
  Link2,
  Pencil,
  Plus,
  RadioTower,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import { showToast } from "@workspace/ui/components/sonner"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import { ServerScopePicker } from "@/components/server-scope-picker"
import type { ServerPickerOption } from "@/components/server-picker-list"
import { timestampedBackupName } from "@/lib/backup-name"
import { relayInstanceRouteId } from "@/lib/relay-fleet"
import {
  readFileDownloadPreferences,
  shouldPreviewBackupDownload,
} from "@/lib/file-download-preferences"
import {
  WorkspaceDataTable,
  WorkspaceTableCell,
  WorkspaceTableHead,
  WorkspaceTableHeading,
  createWorkspaceTableSearchStore,
  useWorkspaceTableSearchInput,
  type WorkspaceTableSearchStore,
} from "@/components/workspace-data-table"
import { roleHasPermission } from "@/lib/permissions"
import {
  accessCapabilitiesQueryOptions,
  backupStorageQueryOptions,
  backupsQueryOptions,
  instanceBackupPolicyQueryOptions,
  managedDatabaseDirectoryQueryOptions,
  queryKeys,
  relaySnapshotQueryOptions,
} from "@/lib/query-options"
import {
  createDatabaseBackup,
  createInstanceBackup,
  createPlatformBackup,
  copyBackupToDestination,
  deleteBackup,
  getBackupDownloadUrl,
  renameBackup,
  restoreDatabaseBackup,
  restoreInstanceBackup,
  type getInstanceBackupPolicy,
  updateInstanceBackupExcludes,
  updateInstanceBackupLimits,
  type getBackups,
} from "@/server/backups"
import type { getAccessCapabilities } from "@/server/access"
import {
  deleteBackupStorage,
  saveBackupStorage,
  setPreferredBackupStorage,
  type getBackupStorage,
} from "@/server/backup-storage"
import type { getManagedDatabaseDirectory } from "@/server/databases"
import type { getRelaySnapshot } from "@/server/relay"

type Backup = Awaited<ReturnType<typeof getBackups>>[number]
type BackupStorage = Awaited<ReturnType<typeof getBackupStorage>>[number]
type InstanceBackupPolicy = Awaited<ReturnType<typeof getInstanceBackupPolicy>>
type BackupAvailabilityDestination = {
  enabled: boolean
  id: string | null
  name: string
  ownerUserId: string | null
}
type BackupAvailabilityTagView = {
  error: string | null
  key: string
  label: string
  name: string
  state: BackupAvailabilityState
  tooltip?: string
}
type BackupAvailabilityState = "available" | "failed" | "missing" | "working"
type BackupTargetPresentation = {
  id: string
  kindLabel: "Database" | "Relay" | "Server"
  name: string
}

export interface BackupFilters {
  kind?: "database" | "relay" | "server"
  relay?: string
  search?: string
  server?: string
  status?: "active" | "available" | "failed"
}

type BackupSearchStore = WorkspaceTableSearchStore
type BackupDialogState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "settings" }
  | { kind: "storage" }
  | { backup: Backup; kind: "delete" }
  | { backup: Backup; kind: "download" }
  | { backup: Backup; kind: "restore" }
type BackupDialogStore = ReturnType<typeof createBackupDialogStore>

const closedBackupDialog = { kind: "closed" } as const
const minimumBackupSyncFeedbackMs = 1000

function createBackupDialogStore() {
  let state: BackupDialogState = closedBackupDialog
  const listeners = new Set<() => void>()

  function publish(next: BackupDialogState) {
    if (next === state) return
    state = next
    for (const listener of listeners) listener()
  }

  return {
    close: () => publish(closedBackupDialog),
    getServerSnapshot: () => closedBackupDialog,
    getSnapshot: () => state,
    open: (next: Exclude<BackupDialogState, { kind: "closed" }>) =>
      publish(next),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

interface CreateTarget {
  id: string
  key: string
  kind: "database" | "instance" | "platform"
  name: string
  relayId: string
  relayName: string
}

const activeStatuses = new Set(["queued", "running", "deleting"])
const mobileBackupLayoutQuery = "(max-width: 767px)"
const backupStatusFilterOptions: ReadonlyArray<{
  label: string
  value: BackupFilters["status"]
}> = [
  { label: "All statuses", value: undefined },
  { label: "Available", value: "available" },
  { label: "In progress", value: "active" },
  { label: "Failed", value: "failed" },
]
const backupDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "full",
  timeStyle: "long",
})
const backupDateCompact = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
})
const backupMinuteMs = 60_000
const backupHourMs = 60 * backupMinuteMs
const backupDayMs = 24 * backupHourMs

function selectBackupScope(
  snapshot: Awaited<ReturnType<typeof getRelaySnapshot>>
) {
  return {
    nodes: snapshot.nodes.map(({ relayId, relayName }) => ({
      relayId,
      relayName,
    })),
    servers: snapshot.instances.map(({ id, name, relayId, relayName }) => ({
      id,
      name,
      relayId,
      relayName,
    })),
  }
}

export function createBackupSearchStore(initialValue: string) {
  return createWorkspaceTableSearchStore(initialValue)
}

export const BackupsPage = React.memo(function BackupsPage({
  filters,
  onFiltersChange,
  searchStore,
}: {
  filters: BackupFilters
  onFiltersChange: (change: Partial<BackupFilters>) => void
  searchStore: BackupSearchStore
}) {
  const { data: backups } = useSuspenseQuery({
    ...backupsQueryOptions(),
    notifyOnChangeProps: ["data"],
  })
  const { data: storage } = useSuspenseQuery(backupStorageQueryOptions())
  const { data: backupScope } = useSuspenseQuery({
    ...relaySnapshotQueryOptions(),
    notifyOnChangeProps: ["data"],
    select: selectBackupScope,
  })
  const { data: databases } = useSuspenseQuery(
    managedDatabaseDirectoryQueryOptions()
  )
  const { data: capabilities } = useSuspenseQuery(
    accessCapabilitiesQueryOptions()
  )
  const [dialogStore] = React.useState(createBackupDialogStore)

  const scopeOptions = React.useMemo(
    () =>
      backupScopeOptions({
        databases,
        includePlatform: capabilities.isPlatformAdmin,
        nodes: backupScope.nodes,
        servers: backupScope.servers,
      }),
    [
      backupScope.nodes,
      backupScope.servers,
      capabilities.isPlatformAdmin,
      databases,
    ]
  )
  const selectedServer = React.useMemo(
    () =>
      scopeOptions.find(
        (option) =>
          option.id === filters.server &&
          option.relayId === filters.relay &&
          (option.kind ?? "server") === (filters.kind ?? "server")
      ) ?? null,
    [filters.kind, filters.relay, filters.server, scopeOptions]
  )
  const selectServer = React.useCallback(
    (server: ServerPickerOption | null) => {
      onFiltersChange({
        kind: server?.kind,
        relay: server?.relayId,
        server: server?.id,
      })
    },
    [onFiltersChange]
  )
  const openSettings = React.useCallback(
    () => dialogStore.open({ kind: "settings" }),
    [dialogStore]
  )
  const targetNames = React.useMemo(() => {
    const names = new Map<string, string>()
    for (const server of backupScope.servers) {
      names.set(targetKey("instance", server.relayId, server.id), server.name)
    }
    for (const database of databases) {
      names.set(
        targetKey("database", database.relayId, database.id),
        database.name
      )
    }
    return names
  }, [backupScope.servers, databases])
  const relayNames = React.useMemo(
    () =>
      new Map([
        ...backupScope.nodes.map(
          (relay) => [relay.relayId, relay.relayName] as const
        ),
        ...backupScope.servers.map(
          (instance) => [instance.relayId, instance.relayName] as const
        ),
      ]),
    [backupScope.nodes, backupScope.servers]
  )
  const storageNames = React.useMemo(
    () =>
      new Map(storage.map((destination) => [destination.id, destination.name])),
    [storage]
  )
  const availabilityDestinations = React.useMemo(
    (): Array<BackupAvailabilityDestination> => [
      { enabled: true, id: null, name: "Local", ownerUserId: null },
      ...storage.map((destination) => ({
        enabled: destination.enabled,
        id: destination.id,
        name: destination.name,
        ownerUserId: destination.ownerUserId,
      })),
    ],
    [storage]
  )
  const filteredBackups = React.useMemo(
    () =>
      backups.filter((backup) => {
        if (backup.status === "deleted") return false
        if (!backupMatchesScope(backup, selectedServer)) return false
        return backupMatchesStatusFilter(backup, filters.status)
      }),
    [backups, filters.status, selectedServer]
  )
  const createTargets = React.useMemo(
    () =>
      availableCreateTargets({
        capabilities,
        databases,
        nodes: backupScope.nodes,
        servers: backupScope.servers,
      }),
    [backupScope.nodes, backupScope.servers, capabilities, databases]
  )
  const scopedCreateTargetKey = selectedServer
    ? selectedBackupCreateTargetKey(selectedServer)
    : undefined
  const selectedCreateTargetKey = createTargets.some(
    (target) => target.key === scopedCreateTargetKey
  )
    ? scopedCreateTargetKey
    : undefined
  const canManageSelectedServer = Boolean(
    selectedServer &&
    (selectedServer.kind ?? "server") === "server" &&
    createTargets.some(
      (target) =>
        target.kind === "instance" &&
        target.relayId === selectedServer.relayId &&
        target.id === selectedServer.id
    )
  )
  const canCreateBackup = React.useCallback(
    (backup: Backup) =>
      backup.targetKind === "platform"
        ? capabilities.isPlatformAdmin
        : canCreateForResource(
            capabilities,
            backup.relayId,
            backup.targetKind,
            backup.targetId
          ),
    [capabilities]
  )

  return (
    <div className="mx-auto flex h-full min-h-[34rem] w-full max-w-[90rem] flex-col px-3 pt-3 pb-3 sm:px-5 sm:pt-5 sm:pb-5">
      <ServerScopePicker
        allDescription="Every accessible server, database, and Relay"
        allLabel="All instances"
        ariaLabel="Accessible instances"
        canManageSettings={canManageSelectedServer}
        changeLabel="Change instance"
        chooseLabel="Choose instance"
        emptyMessage="No accessible instances found."
        selectedServer={selectedServer}
        servers={scopeOptions}
        onManageSettings={openSettings}
        onSelect={selectServer}
      />

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card/45 [contain:paint]">
        <BackupToolbar
          canCreate={createTargets.length > 0}
          dialogStore={dialogStore}
          filters={filters}
          searchStore={searchStore}
          onFiltersChange={onFiltersChange}
        />
        <div className="min-h-0 flex-1 overflow-auto">
          <BackupTable
            backups={filteredBackups}
            canCreate={canCreateBackup}
            currentUserId={capabilities.user.id}
            destinations={availabilityDestinations}
            dialogStore={dialogStore}
            filtered={Boolean(selectedServer || filters.status)}
            relayNames={relayNames}
            searchStore={searchStore}
            targetNames={targetNames}
          />
        </div>
      </section>

      <BackupDialogHost
        capabilities={capabilities}
        dialogStore={dialogStore}
        selectedCreateTargetKey={selectedCreateTargetKey}
        selectedServer={selectedServer}
        storage={storage}
        storageNames={storageNames}
        targetNames={targetNames}
        targets={createTargets}
      />
    </div>
  )
})

const BackupToolbar = React.memo(function BackupToolbar({
  canCreate,
  dialogStore,
  filters,
  onFiltersChange,
  searchStore,
}: {
  canCreate: boolean
  dialogStore: BackupDialogStore
  filters: BackupFilters
  onFiltersChange: (change: Partial<BackupFilters>) => void
  searchStore: BackupSearchStore
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [mobileSearchOpen, setMobileSearchOpen] = React.useState(
    () => searchStore.getSnapshot().length > 0
  )
  useWorkspaceTableSearchInput(inputRef, searchStore)

  React.useEffect(() => {
    if (mobileSearchOpen) inputRef.current?.focus()
  }, [mobileSearchOpen])

  return (
    <div className="flex min-w-0 items-center gap-2 border-b bg-background/25 p-3">
      <BackupSyncButton />

      {!mobileSearchOpen ? (
        <Button
          aria-label="Search backups"
          className="sm:hidden"
          size="icon"
          type="button"
          variant="outline"
          onClick={() => setMobileSearchOpen(true)}
        >
          <Search />
        </Button>
      ) : null}
      <div
        className={`${mobileSearchOpen ? "block" : "hidden"} relative min-w-0 flex-1 sm:block sm:max-w-md`}
      >
        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          aria-label="Search backups"
          className="pl-9 text-base md:text-sm"
          defaultValue={searchStore.getServerSnapshot()}
          placeholder="Search backups"
          type="search"
          onChange={(event) => searchStore.set(event.currentTarget.value)}
        />
      </div>
      {mobileSearchOpen ? (
        <Button
          aria-label="Close backup search"
          className="sm:hidden"
          size="icon"
          type="button"
          variant="ghost"
          onClick={() => {
            searchStore.set("")
            setMobileSearchOpen(false)
          }}
        >
          <X />
        </Button>
      ) : null}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Filter backups by status"
                className={`${mobileSearchOpen ? "hidden sm:inline-flex" : "inline-flex"} shrink-0`}
                type="button"
                variant={filters.status ? "secondary" : "outline"}
              >
                <SlidersHorizontal />
                <span className="hidden lg:inline">
                  {backupStatusFilterLabel(filters.status)}
                </span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Filter by status</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          {backupStatusFilterOptions.map((option) => (
            <DropdownMenuItem
              key={option.label}
              onSelect={() => onFiltersChange({ status: option.value })}
            >
              <span className="w-4">
                {filters.status === option.value ? <Check /> : null}
              </span>
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Manage backup destinations"
            className={`${mobileSearchOpen ? "hidden sm:inline-flex" : "inline-flex"} shrink-0`}
            type="button"
            variant="outline"
            onClick={() => dialogStore.open({ kind: "storage" })}
          >
            <CloudCog />
            <span className="hidden xl:inline">Destinations</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Manage destinations</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="New Backup"
            className={`${mobileSearchOpen ? "hidden sm:inline-flex" : "inline-flex"} ml-auto shrink-0`}
            disabled={!canCreate}
            type="button"
            onClick={() => dialogStore.open({ kind: "create" })}
          >
            <Plus /> <span className="hidden sm:inline">New Backup</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">New Backup</TooltipContent>
      </Tooltip>
    </div>
  )
})

const BackupSyncButton = React.memo(function BackupSyncButton() {
  const { fetchStatus, refetch } = useQuery({
    ...backupsQueryOptions(),
    notifyOnChangeProps: ["fetchStatus"],
  })
  const [spinning, setSpinning] = React.useState(false)
  const fetchDoneRef = React.useRef(true)
  const fallbackTimeoutRef = React.useRef<number>(undefined)
  const mountedRef = React.useRef(true)
  const syncing = spinning || fetchStatus === "fetching"

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (fallbackTimeoutRef.current !== undefined) {
        window.clearTimeout(fallbackTimeoutRef.current)
      }
    }
  }, [])

  const stopSpinIfDone = React.useCallback(() => {
    if (!mountedRef.current || !fetchDoneRef.current) return
    if (fallbackTimeoutRef.current !== undefined) {
      window.clearTimeout(fallbackTimeoutRef.current)
      fallbackTimeoutRef.current = undefined
    }
    setSpinning(false)
  }, [])

  const syncBackups = React.useCallback(() => {
    if (spinning || fetchStatus === "fetching") return
    fetchDoneRef.current = false
    setSpinning(true)
    forkPromise(() =>
      ensuringPromise(refetch, () => {
        fetchDoneRef.current = true
        fallbackTimeoutRef.current = window.setTimeout(
          stopSpinIfDone,
          minimumBackupSyncFeedbackMs
        )
      })
    )
  }, [fetchStatus, refetch, spinning, stopSpinIfDone])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label="Sync backups"
          aria-busy={syncing}
          disabled={syncing}
          size="icon"
          type="button"
          variant="outline"
          onClick={syncBackups}
        >
          <RefreshCw
            className={spinning ? "animate-spin" : ""}
            onAnimationIteration={stopSpinIfDone}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Sync backups</TooltipContent>
    </Tooltip>
  )
})

const BackupDialogHost = React.memo(function BackupDialogHost({
  capabilities,
  dialogStore,
  selectedCreateTargetKey,
  selectedServer,
  storage,
  storageNames,
  targetNames,
  targets,
}: {
  capabilities: Awaited<ReturnType<typeof getAccessCapabilities>>
  dialogStore: BackupDialogStore
  selectedCreateTargetKey?: string
  selectedServer: ServerPickerOption | null
  storage: Array<BackupStorage>
  storageNames: ReadonlyMap<string, string>
  targetNames: ReadonlyMap<string, string>
  targets: Array<CreateTarget>
}) {
  const dialog = React.useSyncExternalStore(
    dialogStore.subscribe,
    dialogStore.getSnapshot,
    dialogStore.getServerSnapshot
  )
  const close = React.useCallback(
    (open: boolean) => {
      if (!open) dialogStore.close()
    },
    [dialogStore]
  )

  if (dialog.kind === "closed") return null
  if (dialog.kind === "create") {
    return (
      <CreateBackupDialog
        initialTargetKey={selectedCreateTargetKey}
        open
        storage={storage}
        targets={targets}
        onOpenChange={close}
      />
    )
  }
  if (dialog.kind === "storage") {
    return (
      <BackupStorageDialog
        currentUserId={capabilities.user.id}
        isPlatformAdmin={capabilities.isPlatformAdmin}
        open
        storage={storage}
        onOpenChange={close}
      />
    )
  }
  if (dialog.kind === "settings") {
    if (!selectedServer || (selectedServer.kind ?? "server") !== "server") {
      return null
    }
    return (
      <InstanceBackupSettingsDialog
        isPlatformAdmin={capabilities.isPlatformAdmin}
        open
        server={selectedServer}
        storage={storage}
        onOpenChange={close}
      />
    )
  }
  if (dialog.kind === "restore") {
    return (
      <RestoreBackupDialog
        backup={dialog.backup}
        open
        targetName={backupTargetName(dialog.backup, targetNames)}
        onOpenChange={close}
      />
    )
  }
  if (dialog.kind === "download") {
    return (
      <DownloadBackupDialog
        backup={dialog.backup}
        open
        storageNames={storageNames}
        onOpenChange={close}
      />
    )
  }
  return <DeleteBackupDialog backup={dialog.backup} open onOpenChange={close} />
})

const BackupTable = React.memo(function BackupTable({
  backups,
  canCreate,
  currentUserId,
  destinations,
  dialogStore,
  filtered,
  relayNames,
  searchStore,
  targetNames,
}: {
  backups: Array<Backup>
  canCreate: (backup: Backup) => boolean
  currentUserId: string
  destinations: ReadonlyArray<BackupAvailabilityDestination>
  dialogStore: BackupDialogStore
  filtered: boolean
  relayNames: ReadonlyMap<string, string>
  searchStore: BackupSearchStore
  targetNames: ReadonlyMap<string, string>
}) {
  const mobileLayout = React.useSyncExternalStore(
    subscribeToMobileBackupLayout,
    getMobileBackupLayoutSnapshot,
    getServerMobileBackupLayoutSnapshot
  )
  const renderRow = React.useCallback(
    (backup: Backup) => (
      <BackupTableRow
        backup={backup}
        canCreate={canCreate(backup)}
        currentUserId={currentUserId}
        destinations={destinations}
        dialogStore={dialogStore}
        relayName={relayNames.get(backup.relayId) ?? backup.relayId}
        targetAvailable={
          backup.targetKind === "platform"
            ? relayNames.has(backup.relayId)
            : targetNames.has(
                targetKey(backup.targetKind, backup.relayId, backup.targetId)
              )
        }
        targetName={backupTargetName(backup, targetNames)}
      />
    ),
    [
      canCreate,
      currentUserId,
      destinations,
      dialogStore,
      relayNames,
      targetNames,
    ]
  )
  const renderMobileRow = React.useCallback(
    (backup: Backup) => (
      <BackupMobileRow
        key={backup.id}
        backup={backup}
        canCreate={canCreate(backup)}
        currentUserId={currentUserId}
        destinations={destinations}
        dialogStore={dialogStore}
        relayName={relayNames.get(backup.relayId) ?? backup.relayId}
        targetAvailable={
          backup.targetKind === "platform"
            ? relayNames.has(backup.relayId)
            : targetNames.has(
                targetKey(backup.targetKind, backup.relayId, backup.targetId)
              )
        }
        targetName={backupTargetName(backup, targetNames)}
      />
    ),
    [
      canCreate,
      currentUserId,
      destinations,
      dialogStore,
      relayNames,
      targetNames,
    ]
  )
  const renderEmpty = React.useCallback(
    (searchActive: boolean) => (
      <div className="grid h-64 place-items-center px-6 text-center">
        <div>
          <Archive className="mx-auto size-7 text-muted-foreground/45" />
          <p className="mt-3 text-sm font-semibold">
            {searchActive
              ? "No backups match this search"
              : filtered
                ? "No backups match these filters"
                : "No backups yet"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Manual backups appear here as soon as Relay accepts them.
          </p>
        </div>
      </div>
    ),
    [filtered]
  )

  return (
    <div id="backup-table-root">
      {mobileLayout ? (
        <BackupMobileList
          backups={backups}
          renderEmpty={renderEmpty}
          renderRow={renderMobileRow}
          searchStore={searchStore}
        />
      ) : (
        <WorkspaceDataTable
          getRowKey={backupRowKey}
          getSearchText={backupSearchText}
          head={<BackupTableHead />}
          items={backups}
          renderEmpty={renderEmpty}
          renderRow={renderRow}
          searchStore={searchStore}
        />
      )}
    </div>
  )
})

const BackupMobileList = React.memo(function BackupMobileList({
  backups,
  renderEmpty,
  renderRow,
  searchStore,
}: {
  backups: Array<Backup>
  renderEmpty: (searchActive: boolean) => React.ReactNode
  renderRow: (backup: Backup) => React.ReactNode
  searchStore: BackupSearchStore
}) {
  const search = React.useSyncExternalStore(
    searchStore.subscribe,
    searchStore.getSnapshot,
    searchStore.getServerSnapshot
  )
  const normalizedSearch = search.trim().toLowerCase()
  const visible = React.useMemo(
    () =>
      backups.filter(
        (backup) =>
          normalizedSearch.length === 0 ||
          backupSearchText(backup).toLowerCase().includes(normalizedSearch)
      ),
    [backups, normalizedSearch]
  )

  if (visible.length === 0) return renderEmpty(normalizedSearch.length > 0)
  return (
    <div className="divide-y divide-border/70">{visible.map(renderRow)}</div>
  )
})

const BackupTableHead = React.memo(function BackupTableHead() {
  return (
    <WorkspaceTableHead className="sticky top-0 z-20 bg-background/95 shadow-[0_1px_0_var(--border)] backdrop-blur">
      <WorkspaceTableHeading className="w-[26%] min-w-0">
        Backup
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="hidden w-[28%] min-w-0 md:table-cell">
        Target
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="hidden w-[12rem] sm:table-cell">
        File
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="hidden w-[5.5rem] lg:table-cell">
        Size
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="hidden w-[5.25rem] xl:table-cell">
        Created
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="w-[11.25rem]">
        Actions
      </WorkspaceTableHeading>
    </WorkspaceTableHead>
  )
})

const BackupTableRow = React.memo(function BackupTableRow({
  backup,
  canCreate,
  currentUserId,
  destinations,
  dialogStore,
  relayName,
  targetAvailable,
  targetName,
}: {
  backup: Backup
  canCreate: boolean
  currentUserId: string
  destinations: ReadonlyArray<BackupAvailabilityDestination>
  dialogStore: BackupDialogStore
  relayName: string
  targetAvailable: boolean
  targetName: string
}) {
  const target = backupTargetPresentation(backup, relayName, targetName)

  return (
    <tr className="group transition-colors hover:bg-muted/20 has-checked:bg-primary/[0.07]">
      <WorkspaceTableCell className="h-auto py-2.5">
        <div className="min-w-0">
          <BackupNameEditor
            backupId={backup.id}
            editable={canCreate}
            name={backup.name}
          />
          {backup.taskError ? (
            <p className="mt-1 line-clamp-1 text-[0.625rem] text-destructive">
              {backup.taskError}
            </p>
          ) : null}
          <BackupAvailabilityTags
            backup={backup}
            canCopy={canCreate}
            currentUserId={currentUserId}
            destinations={destinations}
          />
        </div>
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden h-auto py-2.5 md:table-cell">
        <BackupTargetLink
          available={targetAvailable}
          relayId={backup.relayId}
          target={target}
          targetId={backup.targetId}
          targetKind={backup.targetKind}
        />
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden h-auto py-2.5 text-sm text-muted-foreground sm:table-cell">
        <span className="block truncate" title={backup.filename ?? backup.id}>
          {backup.filename ?? backup.id}
        </span>
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden h-auto py-2.5 text-sm whitespace-nowrap text-muted-foreground lg:table-cell">
        {backup.bytes === null ? "—" : formatBytes(backup.bytes)}
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden h-auto py-2.5 text-sm whitespace-nowrap text-muted-foreground xl:table-cell">
        <BackupCreatedTime createdAt={backup.createdAt} />
      </WorkspaceTableCell>
      <WorkspaceTableCell className="h-auto py-2.5">
        <BackupRowActions
          backup={backup}
          dialogStore={dialogStore}
          targetAvailable={targetAvailable}
        />
      </WorkspaceTableCell>
    </tr>
  )
})

const BackupMobileRow = React.memo(function BackupMobileRow({
  backup,
  canCreate,
  currentUserId,
  destinations,
  dialogStore,
  relayName,
  targetAvailable,
  targetName,
}: {
  backup: Backup
  canCreate: boolean
  currentUserId: string
  destinations: ReadonlyArray<BackupAvailabilityDestination>
  dialogStore: BackupDialogStore
  relayName: string
  targetAvailable: boolean
  targetName: string
}) {
  const target = backupTargetPresentation(backup, relayName, targetName)
  return (
    <article aria-label={backup.name} className="min-w-0 p-3">
      <BackupNameEditor
        backupId={backup.id}
        editable={canCreate}
        name={backup.name}
      />
      {backup.taskError ? (
        <p className="mt-1 line-clamp-2 text-[0.625rem] text-destructive">
          {backup.taskError}
        </p>
      ) : null}
      <div className="mt-2.5 overflow-hidden rounded-lg border bg-background/45 px-3 py-2.5">
        <BackupTargetLink
          available={targetAvailable}
          relayId={backup.relayId}
          target={target}
          targetId={backup.targetId}
          targetKind={backup.targetKind}
        />
      </div>
      <div className="mt-2.5 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-xs text-muted-foreground">
        <span className="truncate" title={backup.filename ?? backup.id}>
          {backup.filename ?? backup.id}
        </span>
        <span className="whitespace-nowrap">
          {backup.bytes === null ? "—" : formatBytes(backup.bytes)} ·{" "}
          <BackupCreatedTime createdAt={backup.createdAt} />
        </span>
      </div>
      <BackupAvailabilityTags
        backup={backup}
        canCopy={canCreate}
        currentUserId={currentUserId}
        destinations={destinations}
      />
      <div className="mt-3 flex justify-end border-t pt-2.5">
        <BackupRowActions
          backup={backup}
          dialogStore={dialogStore}
          targetAvailable={targetAvailable}
        />
      </div>
    </article>
  )
})

const BackupRowActions = React.memo(function BackupRowActions({
  backup,
  dialogStore,
  targetAvailable,
}: {
  backup: Backup
  dialogStore: BackupDialogStore
  targetAvailable: boolean
}) {
  const canRestore =
    backup.status === "available" &&
    !backupSourceIsActive(backup) &&
    targetAvailable &&
    (backup.targetKind === "instance" || backup.targetKind === "database")
  const restore = (
    <Button
      aria-label={`Restore ${backup.name}`}
      disabled={!canRestore}
      size="sm"
      type="button"
      variant="outline"
      onClick={() => dialogStore.open({ backup, kind: "restore" })}
    >
      <RotateCcwClock /> Restore
    </Button>
  )
  return (
    <div className="flex items-center gap-0.5">
      {targetAvailable ? (
        restore
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">{restore}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {missingTargetMessage(backup.targetKind)}
          </TooltipContent>
        </Tooltip>
      )}
      <BackupActionButton
        disabled={backup.status !== "available"}
        icon={Download}
        label={`Download ${backup.name}`}
        tooltip="Download or create a link"
        onClick={() => dialogStore.open({ backup, kind: "download" })}
      />
      <BackupActionButton
        disabled={backupIsActive(backup)}
        icon={Trash2}
        label={`Delete ${backup.name}`}
        tooltip="Delete backup"
        onClick={() => dialogStore.open({ backup, kind: "delete" })}
      />
    </div>
  )
})

const BackupNameEditor = React.memo(function BackupNameEditor({
  backupId,
  editable,
  name,
}: {
  backupId: string
  editable: boolean
  name: string
}) {
  const queryClient = useQueryClient()
  const nameRef = React.useRef<HTMLInputElement>(null)
  const [editing, setEditing] = React.useState(false)
  const rename = useMutation({
    mutationFn: (nextName: string) =>
      renameBackup({ data: { backupId, name: nextName } }),
    onError: (error) => {
      showToast({
        message:
          error instanceof Error ? error.message : "Could not rename backup",
        type: "error",
      })
    },
    onSuccess: (result: { name: string }) => {
      queryClient.setQueryData<Array<Backup>>(
        queryKeys.backups.all,
        (current) => {
          if (!current) return current
          return current.map((item) =>
            item.id === backupId ? { ...item, name: result.name } : item
          )
        }
      )
      setEditing(false)
      showToast({
        message: "Backup renamed",
        type: "success",
      })
    },
  })

  React.useLayoutEffect(() => {
    if (!editing) return
    const input = nameRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [editing])

  const saveName = () => {
    if (rename.isPending) return
    const next = nameRef.current?.value.trim() ?? ""
    if (next.length === 0) {
      showToast({
        message: "Backup name is required",
        type: "error",
      })
      return
    }
    if (next === name) {
      setEditing(false)
      return
    }
    rename.mutate(next)
  }

  const cancelEditing = () => {
    if (rename.isPending) return
    setEditing(false)
  }

  return (
    <div className="flex h-6 min-w-0 items-center gap-1">
      {editing && editable ? (
        <>
          <input
            ref={nameRef}
            aria-label={`Backup name for ${name}`}
            autoComplete="off"
            className="h-6 min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-sm leading-6 font-semibold shadow-none outline-none focus-visible:text-foreground"
            defaultValue={name}
            disabled={rename.isPending}
            maxLength={120}
            spellCheck={false}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                cancelEditing()
              } else if (event.key === "Enter") {
                event.preventDefault()
                saveName()
              }
            }}
          />
          <BackupActionButton
            disabled={rename.isPending}
            icon={Check}
            label={`Save name for ${name}`}
            size="icon-xs"
            spinning={rename.isPending}
            tooltip="Save"
            onClick={saveName}
          />
          <BackupActionButton
            disabled={rename.isPending}
            icon={X}
            label={`Cancel renaming ${name}`}
            size="icon-xs"
            tooltip="Cancel"
            onClick={cancelEditing}
          />
        </>
      ) : (
        <>
          <p
            className="min-w-0 truncate text-sm leading-6 font-semibold"
            title={name}
          >
            {name}
          </p>
          {editable ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={`Edit name for ${name}`}
                  className="shrink-0"
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                  onClick={() => setEditing(true)}
                >
                  <Pencil />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Edit name</TooltipContent>
            </Tooltip>
          ) : null}
        </>
      )}
    </div>
  )
})

const BackupAvailabilityTags = React.memo(function BackupAvailabilityTags({
  backup,
  canCopy,
  currentUserId,
  destinations,
}: {
  backup: Backup
  canCopy: boolean
  currentUserId: string
  destinations: ReadonlyArray<BackupAvailabilityDestination>
}) {
  const queryClient = useQueryClient()
  const tags = backupAvailabilityTags(backup, destinations)
  const extraDestinations = extraBackupDestinations(
    backup,
    currentUserId,
    destinations
  )
  const copyDisabledReason = backupCopyDisabledReason(
    backup,
    canCopy,
    destinations,
    extraDestinations
  )
  const copy = useMutation({
    mutationFn: (storageId: string) =>
      copyBackupToDestination({
        data: { backupId: backup.id, storageId },
      }),
    onError: (error) => {
      showToast({
        message:
          error instanceof Error ? error.message : "Could not copy this backup",
        type: "error",
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.backups.all })
      showToast({
        message: "Backup copy started",
        type: "success",
      })
    },
  })
  const plusButton = (
    <Button
      aria-label={`Copy ${backup.name} to another destination`}
      className="shrink-0"
      disabled={copy.isPending}
      size="icon-xs"
      type="button"
      variant="ghost"
    >
      {copy.isPending ? <LoaderCircle className="animate-spin" /> : <Plus />}
    </Button>
  )

  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="text-[0.625rem] text-muted-foreground">
        Availability:
      </span>
      {tags.map((tag) => (
        <BackupAvailabilityTag key={tag.key} tag={tag} />
      ))}
      {copyDisabledReason ? null : extraDestinations.length === 1 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={`Copy ${backup.name} to ${extraDestinations[0]?.name}`}
              className="shrink-0"
              disabled={copy.isPending}
              size="icon-xs"
              type="button"
              variant="ghost"
              onClick={() => {
                const storageId = extraDestinations[0]?.id
                if (storageId) copy.mutate(storageId)
              }}
            >
              {copy.isPending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Plus />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            Copy to {extraDestinations[0]?.name}
          </TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>{plusButton}</DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">
              Copy to another destination
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start">
            {extraDestinations.map((destination) => (
              <DropdownMenuItem
                key={destination.id}
                disabled={copy.isPending}
                onSelect={() => {
                  if (destination.id) copy.mutate(destination.id)
                }}
              >
                {destination.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
})

function BackupAvailabilityTag({ tag }: { tag: BackupAvailabilityTagView }) {
  const working = tag.state === "working"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex h-6 max-w-36 items-center gap-1 rounded-md border px-2 font-mono text-[0.5625rem] font-semibold ${tag.key === "local" || tag.key === "s3" ? "uppercase" : ""} ${availabilityTagClassName(tag.state)}`}
        >
          {working ? (
            <LoaderCircle className="size-2.5 shrink-0 animate-spin" />
          ) : tag.state === "available" ? (
            <Check className="size-2.5 shrink-0" />
          ) : null}
          <span className="truncate">{tag.label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {tag.tooltip ??
          `${tag.name} · ${availabilityStateLabel(tag.state)}${
            tag.error ? ` · ${tag.error}` : ""
          }`}
      </TooltipContent>
    </Tooltip>
  )
}

function BackupMissingTargetTooltip({
  children,
  kind,
  missing,
}: {
  children: React.ReactElement
  kind: Backup["targetKind"]
  missing: boolean
}) {
  if (!missing) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{missingTargetMessage(kind)}</TooltipContent>
    </Tooltip>
  )
}

const BackupTargetIcon = React.memo(function BackupTargetIcon({
  kind,
}: {
  kind: Backup["targetKind"]
}) {
  const Icon =
    kind === "database" ? Database : kind === "platform" ? RadioTower : Server
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground">
      <Icon className="size-5" />
    </span>
  )
})

function BackupTargetLayout({
  copyButton,
  icon,
  name,
}: {
  copyButton: React.ReactNode
  icon: React.ReactNode
  name: React.ReactNode
}) {
  return (
    <div className="-mx-3 -my-2.5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 px-3 py-2.5">
      <span className="row-span-2">{icon}</span>
      {name}
      {copyButton}
    </div>
  )
}

const BackupCopyIdButton = React.memo(function BackupCopyIdButton({
  id,
  kindLabel,
}: {
  id: string
  kindLabel: BackupTargetPresentation["kindLabel"]
}) {
  const [copied, setCopied] = React.useState(false)
  const copiedTimer = React.useRef<number | null>(null)
  React.useEffect(
    () => () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
    },
    []
  )
  const copyId = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      forkPromise(async () => {
        await navigator.clipboard.writeText(id)
        setCopied(true)
        if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
        copiedTimer.current = window.setTimeout(() => setCopied(false), 1_800)
      })
    },
    [id]
  )

  return (
    <button
      type="button"
      aria-label={copied ? `${kindLabel} ID copied` : `Copy ${kindLabel} ID`}
      className={`inline-flex items-center gap-1 text-xs transition-colors ${
        copied
          ? "text-emerald-400"
          : "text-muted-foreground hover:text-foreground"
      }`}
      onClick={copyId}
    >
      Copy ID
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
})

const BackupTargetLink = React.memo(function BackupTargetLink({
  available,
  relayId,
  target,
  targetId,
  targetKind,
}: {
  available: boolean
  relayId: string
  target: BackupTargetPresentation
  targetId: string
  targetKind: Backup["targetKind"]
}) {
  const name = (
    <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
      <span className="shrink-0 text-muted-foreground">
        {target.kindLabel}:
      </span>
      {available ? (
        <BackupTargetNameAnchor
          relayId={relayId}
          searchId={target.id}
          targetId={targetId}
          targetKind={targetKind}
          targetName={target.name}
        />
      ) : (
        <span className="min-w-0 truncate text-muted-foreground">
          {target.name}
        </span>
      )}
    </span>
  )
  const layout = (
    <BackupTargetLayout
      copyButton={
        <BackupCopyIdButton id={target.id} kindLabel={target.kindLabel} />
      }
      icon={<BackupTargetIcon kind={targetKind} />}
      name={name}
    />
  )

  if (available) return layout

  return (
    <BackupMissingTargetTooltip kind={targetKind} missing>
      <div
        aria-label={missingTargetMessage(targetKind)}
        className="cursor-help"
      >
        {layout}
      </div>
    </BackupMissingTargetTooltip>
  )
})

const BackupTargetNameAnchor = React.memo(function BackupTargetNameAnchor({
  relayId,
  searchId,
  targetId,
  targetKind,
  targetName,
}: {
  relayId: string
  searchId: string
  targetId: string
  targetKind: Backup["targetKind"]
  targetName: string
}) {
  const className =
    "inline-flex min-w-0 items-center gap-1.5 text-primary outline-none transition-colors hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/40"
  const label = (
    <>
      <span className="truncate">{targetName}</span>
      <ExternalLink className="size-3.5 shrink-0 text-primary/75" />
    </>
  )

  if (targetKind === "instance") {
    return (
      <Link
        aria-label={`Open ${targetName}`}
        className={className}
        params={{
          serverId: relayInstanceRouteId(relayId, targetId.slice(0, 8)),
        }}
        preload="intent"
        to="/server/$serverId/console"
      >
        {label}
      </Link>
    )
  }

  if (targetKind === "database") {
    return (
      <Link
        aria-label={`Open ${targetName}`}
        className={className}
        preload="intent"
        search={{ search: searchId }}
        to="/infra/databases"
      >
        {label}
      </Link>
    )
  }

  return (
    <Link
      aria-label={`View ${targetName}`}
      className={className}
      preload="intent"
      to="/infra/relays"
    >
      {label}
    </Link>
  )
})

function BackupCreatedTime({ createdAt }: { createdAt: string }) {
  const timestamp = new Date(createdAt).getTime()
  const relative = shortRelativeBackupTime(timestamp)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time
          className="block truncate text-sm"
          dateTime={createdAt}
          suppressHydrationWarning
        >
          {relative ?? backupDateCompact.format(timestamp)}
        </time>
      </TooltipTrigger>
      <TooltipContent side="top">
        <span suppressHydrationWarning>{backupDate.format(timestamp)}</span>
      </TooltipContent>
    </Tooltip>
  )
}

function BackupActionButton({
  disabled,
  icon: Icon,
  label,
  onClick,
  size = "icon-sm",
  spinning = false,
  tooltip,
}: {
  disabled: boolean
  icon: typeof Download
  label: string
  onClick: () => void
  size?: "icon" | "icon-sm" | "icon-xs"
  spinning?: boolean
  tooltip: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          disabled={disabled}
          size={size}
          type="button"
          variant="ghost"
          onClick={onClick}
        >
          <Icon className={spinning ? "animate-spin" : ""} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  )
}

function DownloadBackupDialog({
  backup,
  onOpenChange,
  open,
  storageNames,
}: {
  backup: Backup
  onOpenChange: (open: boolean) => void
  open: boolean
  storageNames: ReadonlyMap<string, string>
}) {
  const availableArtifacts = backup.artifacts.filter(
    (artifact) => artifact.status === "available"
  )
  const [artifactId, setArtifactId] = React.useState(
    () =>
      availableArtifacts.find((artifact) => artifact.storageId === null)?.id ??
      availableArtifacts[0]?.id ??
      ""
  )
  const [expiryValue, setExpiryValue] = React.useState("15")
  const [expiryUnit, setExpiryUnit] = React.useState<"hours" | "minutes">(
    "minutes"
  )
  const [shared, setShared] = React.useState<{
    expiresAt: string
    url: string
  } | null>(null)
  const artifact = availableArtifacts.find(
    (candidate) => candidate.id === artifactId
  )
  const expiresInSeconds = Math.min(
    7 * 24 * 60 * 60,
    Math.max(
      60,
      Math.round(
        Number(expiryValue || 0) * (expiryUnit === "hours" ? 3600 : 60)
      )
    )
  )
  const signDownload = useMutation({
    mutationFn: (mode: "download" | "link") =>
      getBackupDownloadUrl({
        data: {
          artifactId,
          backupId: backup.id,
          expiresInSeconds: mode === "download" ? 300 : expiresInSeconds,
          preview: shouldPreviewBackupDownload(
            mode,
            readFileDownloadPreferences().previewBackupDownloads
          ),
        },
      }),
    onSuccess: (result, mode) => {
      if (mode === "link") {
        setShared(result)
        return
      }
      const anchor = document.createElement("a")
      anchor.href = result.url
      anchor.rel = "noopener"
      anchor.click()
    },
    onError: (error) =>
      showToast({
        message: `Download failed: ${error.message}`,
        type: "error",
      }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Download {backup.name}</DialogTitle>
          <DialogDescription>
            Choose an available copy, then download it or create a temporary
            signed URL.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-medium">Source</span>
            <select
              aria-label="Backup download source"
              className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={artifactId}
              onChange={(event) => {
                setArtifactId(event.currentTarget.value)
                setShared(null)
              }}
            >
              {availableArtifacts.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.storageId
                    ? `${storageNames.get(candidate.storageId) ?? "S3"} · S3`
                    : "Local Relay"}
                  {candidate.bytes === null
                    ? ""
                    : ` · ${formatBytes(candidate.bytes)}`}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/15 p-3">
            <div>
              <p className="font-mono text-[0.5625rem] tracking-wider text-muted-foreground uppercase">
                Destination
              </p>
              <p className="mt-1 truncate text-sm font-medium">
                {artifact?.storageId
                  ? (storageNames.get(artifact.storageId) ?? "S3")
                  : "Local Relay"}
              </p>
            </div>
            <div>
              <p className="font-mono text-[0.5625rem] tracking-wider text-muted-foreground uppercase">
                Size
              </p>
              <p className="mt-1 font-mono text-sm font-medium">
                {artifact?.bytes === null || artifact?.bytes === undefined
                  ? "—"
                  : formatBytes(artifact.bytes)}
              </p>
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Link2 className="size-4 text-muted-foreground" />
              <p className="text-xs font-medium">Temporary URL</p>
            </div>
            <div className="mt-3 flex gap-2">
              <Input
                aria-label="Temporary URL duration"
                className="min-w-0 flex-1"
                min={1}
                type="number"
                value={expiryValue}
                onChange={(event) => {
                  setExpiryValue(event.currentTarget.value)
                  setShared(null)
                }}
              />
              <select
                aria-label="Temporary URL duration unit"
                className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                value={expiryUnit}
                onChange={(event) => {
                  setExpiryUnit(
                    event.currentTarget.value === "hours" ? "hours" : "minutes"
                  )
                  setShared(null)
                }}
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
              </select>
              <Button
                disabled={!artifact || signDownload.isPending}
                type="button"
                variant="outline"
                onClick={() => signDownload.mutate("link")}
              >
                {signDownload.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Link2 />
                )}
                Get URL
              </Button>
            </div>
            <p className="mt-2 text-[0.625rem] text-muted-foreground">
              Links can remain valid from 1 minute up to 7 days.
            </p>
            {shared ? (
              <div className="mt-3 flex gap-2">
                <Input
                  aria-label="Generated temporary backup URL"
                  className="font-mono text-[0.625rem]"
                  readOnly
                  value={shared.url}
                />
                <Button
                  aria-label="Copy temporary URL"
                  size="icon"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(shared.url).then(() =>
                      showToast({
                        message: "Temporary URL copied",
                        type: "success",
                      })
                    )
                  }}
                >
                  <Copy />
                </Button>
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button
            disabled={!artifact || signDownload.isPending}
            type="button"
            onClick={() => signDownload.mutate("download")}
          >
            {signDownload.isPending ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Download />
            )}
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BackupDestinationChoice({
  checked,
  description,
  icon: Icon,
  label,
  onCheckedChange,
}: {
  checked: boolean
  description: string
  icon: typeof Cloud
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
        checked
          ? "border-primary/45 bg-primary/5"
          : "border-border/80 hover:bg-muted/25"
      }`}
    >
      <input
        checked={checked}
        className="sr-only"
        type="checkbox"
        onChange={(event) => onCheckedChange(event.currentTarget.checked)}
      />
      <span
        className={`grid size-8 shrink-0 place-items-center rounded-md border ${
          checked
            ? "border-primary/30 bg-primary/10 text-primary"
            : "text-muted-foreground"
        }`}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold">{label}</span>
        <span className="block truncate text-[0.625rem] text-muted-foreground">
          {description}
        </span>
      </span>
      <span
        className={`grid size-4 place-items-center rounded-sm border ${
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input"
        }`}
      >
        {checked ? <Check className="size-3" /> : null}
      </span>
    </label>
  )
}

function CreateBackupDialog({
  initialTargetKey,
  onOpenChange,
  open,
  storage,
  targets,
}: {
  initialTargetKey?: string
  onOpenChange: (open: boolean) => void
  open: boolean
  storage: Array<BackupStorage>
  targets: Array<CreateTarget>
}) {
  const queryClient = useQueryClient()
  const [name, setName] = React.useState(() => timestampedBackupName("manual"))
  const [targetKeyValue, setTargetKeyValue] = React.useState(
    () =>
      targets.find((target) => target.key === initialTargetKey)?.key ??
      targets.at(0)?.key ??
      ""
  )
  const [destinationKeys, setDestinationKeys] = React.useState<Array<string>>([
    "default",
  ])
  const target = targets.find((candidate) => candidate.key === targetKeyValue)
  const availableStorage = React.useMemo(
    () =>
      storage.filter(
        (destination) =>
          destination.enabled &&
          (target?.kind !== "platform" || destination.ownerUserId === null)
      ),
    [storage, target?.kind]
  )
  const selectedDestinations = React.useMemo(
    () => new Set(destinationKeys),
    [destinationKeys]
  )
  const create = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error("Choose a backup target")
      const data = {
        maxBytes: null,
        name: name.trim(),
        relayId: target.relayId,
        ...(selectedDestinations.has("default")
          ? {}
          : {
              storageIds: destinationKeys.map((destination) =>
                destination === "local" ? null : destination
              ),
            }),
      }
      if (target.kind === "instance") {
        return createInstanceBackup({
          data: { ...data, instanceId: target.id },
        })
      }
      if (target.kind === "database") {
        return createDatabaseBackup({
          data: { ...data, databaseId: target.id },
        })
      }
      return createPlatformBackup({ data })
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.backups.all })
      showToast({
        message: result.relayAccepted
          ? `${name.trim()} queued`
          : `${name.trim()} saved and will resume when Relay reconnects`,
        type: result.relayAccepted ? "success" : "warning",
      })
      onOpenChange(false)
    },
  })

  React.useEffect(() => {
    const allowed = new Set([
      "default",
      "local",
      ...availableStorage.map((destination) => destination.id),
    ])
    setDestinationKeys((current) => {
      const next = current.filter((destination) => allowed.has(destination))
      return next.length > 0 ? next : ["default"]
    })
  }, [availableStorage])

  const toggleDestination = (destination: string, checked: boolean) => {
    setDestinationKeys((current) => {
      if (destination === "default") {
        return checked ? ["default"] : ["local"]
      }
      const withoutDefault = current.filter((key) => key !== "default")
      const next = checked
        ? [...new Set([...withoutDefault, destination])]
        : withoutDefault.filter((key) => key !== destination)
      return next.length > 0 ? next : ["default"]
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create backup</DialogTitle>
          <DialogDescription>
            Relay runs this job in its single durable queue. Servers remain
            online while their data is archived.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-medium">Name</span>
            <Input
              autoFocus
              aria-label="Backup name"
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-medium">Target</span>
            <select
              aria-label="Backup target"
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={targetKeyValue}
              onChange={(event) => setTargetKeyValue(event.currentTarget.value)}
            >
              {targets.map((option) => (
                <option key={option.key} value={option.key}>
                  {targetKindLabel(option.kind)} · {option.name} ·{" "}
                  {option.relayName}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend className="mb-2 text-xs font-medium">Destinations</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <BackupDestinationChoice
                checked={selectedDestinations.has("default")}
                description="Use the target’s preferred destination"
                icon={CloudCog}
                label="Default"
                onCheckedChange={(checked) =>
                  toggleDestination("default", checked)
                }
              />
              <BackupDestinationChoice
                checked={selectedDestinations.has("local")}
                description="Keep a copy on this Relay"
                icon={HardDrive}
                label="Local"
                onCheckedChange={(checked) =>
                  toggleDestination("local", checked)
                }
              />
              {availableStorage.map((destination) => (
                <BackupDestinationChoice
                  key={destination.id}
                  checked={selectedDestinations.has(destination.id)}
                  description={destination.name}
                  icon={Cloud}
                  label="S3"
                  onCheckedChange={(checked) =>
                    toggleDestination(destination.id, checked)
                  }
                />
              ))}
            </div>
            <span className="mt-1.5 block text-[0.625rem] text-muted-foreground">
              {target?.kind === "platform"
                ? "Platform bundles can use Relay-local and platform-owned S3 destinations."
                : target?.kind === "instance"
                  ? "Choose one or more copies. Default uses this server’s preferred destination."
                  : "Choose one or more copies. Default uses Relay-local storage."}
            </span>
          </fieldset>
          {create.error ? (
            <p className="text-xs text-destructive">{create.error.message}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            type="button"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={create.isPending || !name.trim() || !target}
            type="button"
            onClick={() => create.mutate()}
          >
            {create.isPending ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Archive />
            )}
            Create backup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InstanceBackupSettingsDialog({
  isPlatformAdmin,
  onOpenChange,
  open,
  server,
  storage,
}: {
  isPlatformAdmin: boolean
  onOpenChange: (open: boolean) => void
  open: boolean
  server: ServerPickerOption
  storage: Array<BackupStorage>
}) {
  const policy = useQuery(
    instanceBackupPolicyQueryOptions(server.relayId, server.id)
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{server.name} backup settings</DialogTitle>
          <DialogDescription>
            Set retention ceilings, a preferred destination, and extra archive
            exclusions. Relay’s built-in lockfile exclusions still apply.
          </DialogDescription>
        </DialogHeader>
        {policy.data ? (
          <InstanceBackupSettingsEditor
            key={`${server.relayId}:${server.id}`}
            isPlatformAdmin={isPlatformAdmin}
            policy={policy.data}
            server={server}
            storage={storage}
            onSaved={() => onOpenChange(false)}
          />
        ) : policy.error ? (
          <p className="text-xs text-destructive">{policy.error.message}</p>
        ) : (
          <div className="grid h-40 place-items-center text-muted-foreground">
            <LoaderCircle className="size-5 animate-spin" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function InstanceBackupSettingsEditor({
  isPlatformAdmin,
  onSaved,
  policy,
  server,
  storage,
}: {
  isPlatformAdmin: boolean
  onSaved: () => void
  policy: InstanceBackupPolicy
  server: ServerPickerOption
  storage: Array<BackupStorage>
}) {
  const queryClient = useQueryClient()
  const [quantityLimit, setQuantityLimit] = React.useState(
    () => policy.quantityLimit?.toString() ?? ""
  )
  const [sizeLimit, setSizeLimit] = React.useState(() =>
    bytesToGiBInput(policy.sizeLimitBytes)
  )
  const [adminQuantityLimit, setAdminQuantityLimit] = React.useState(
    () => policy.adminQuantityLimit?.toString() ?? ""
  )
  const [adminSizeLimit, setAdminSizeLimit] = React.useState(() =>
    bytesToGiBInput(policy.adminSizeLimitBytes)
  )
  const [storageId, setStorageId] = React.useState(policy.storageId ?? "local")
  const [exclude, setExclude] = React.useState(() => policy.exclude.join("\n"))
  const enabledStorage = React.useMemo(
    () => storage.filter((destination) => destination.enabled),
    [storage]
  )
  const save = useMutation({
    mutationFn: async () => {
      const operations: Array<Promise<unknown>> = [
        updateInstanceBackupLimits({
          data: {
            instanceId: server.id,
            quantityLimit: parseOptionalInteger(
              quantityLimit,
              "Quantity limit"
            ),
            relayId: server.relayId,
            scope: "user",
            sizeLimitBytes: parseOptionalGiB(sizeLimit, "Size limit"),
          },
        }),
        updateInstanceBackupExcludes({
          data: {
            exclude: excludeLines(exclude),
            instanceId: server.id,
            relayId: server.relayId,
          },
        }),
        setPreferredBackupStorage({
          data: {
            instanceId: server.id,
            relayId: server.relayId,
            storageId: storageId === "local" ? null : storageId,
          },
        }),
      ]
      if (isPlatformAdmin) {
        operations.push(
          updateInstanceBackupLimits({
            data: {
              instanceId: server.id,
              quantityLimit: parseOptionalInteger(
                adminQuantityLimit,
                "Platform quantity limit"
              ),
              relayId: server.relayId,
              scope: "platform",
              sizeLimitBytes: parseOptionalGiB(
                adminSizeLimit,
                "Platform size limit"
              ),
            },
          })
        )
      }
      await Promise.all(operations)
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.backups.policy(server.relayId, server.id),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.backups.all }),
      ])
      showToast({
        message: `${server.name} backup settings saved`,
        type: "success",
      })
      onSaved()
    },
  })

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <StorageTextField
          label="Quantity limit"
          placeholder="Unlimited"
          type="number"
          value={quantityLimit}
          onChange={setQuantityLimit}
        />
        <StorageTextField
          label="Size limit (GiB)"
          placeholder="Unlimited"
          type="number"
          value={sizeLimit}
          onChange={setSizeLimit}
        />
        {isPlatformAdmin ? (
          <StorageTextField
            label="Platform quantity ceiling"
            placeholder="Not enforced"
            type="number"
            value={adminQuantityLimit}
            onChange={setAdminQuantityLimit}
          />
        ) : null}
        {isPlatformAdmin ? (
          <StorageTextField
            label="Platform size ceiling (GiB)"
            placeholder="Not enforced"
            type="number"
            value={adminSizeLimit}
            onChange={setAdminSizeLimit}
          />
        ) : null}
        {!isPlatformAdmin &&
        (policy.adminQuantityLimit !== null ||
          policy.adminSizeLimitBytes !== null) ? (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 p-3 text-[0.625rem] leading-4 text-muted-foreground sm:col-span-2">
            Platform ceiling: {policy.adminQuantityLimit ?? "unlimited"} backups
            ·{" "}
            {policy.adminSizeLimitBytes === null
              ? " unlimited size"
              : ` ${formatBytes(policy.adminSizeLimitBytes)}`}
          </div>
        ) : null}
        <label className="block sm:col-span-2">
          <span className="mb-2 block text-xs font-medium">
            Preferred destination
          </span>
          <select
            aria-label="Preferred backup destination"
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            value={storageId}
            onChange={(event) => setStorageId(event.currentTarget.value)}
          >
            <option value="local">Local Relay storage</option>
            {enabledStorage.map((destination) => (
              <option key={destination.id} value={destination.id}>
                {destination.name} · S3
              </option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-2 block text-xs font-medium">
            Extra exclusions
          </span>
          <Textarea
            aria-label="Extra backup exclusions"
            className="min-h-28 font-mono text-xs"
            placeholder={"cache/**\nlogs/*.log\nworld/session.lock"}
            value={exclude}
            onChange={(event) => setExclude(event.currentTarget.value)}
          />
          <span className="mt-1.5 block text-[0.625rem] text-muted-foreground">
            One relative glob per line. Absolute paths and parent traversal are
            rejected by Relay.
          </span>
        </label>
      </div>
      {save.error ? (
        <p className="text-xs text-destructive">{save.error.message}</p>
      ) : null}
      <DialogFooter>
        <Button variant="ghost" type="button" onClick={onSaved}>
          Cancel
        </Button>
        <Button
          disabled={save.isPending}
          type="button"
          onClick={() => save.mutate()}
        >
          {save.isPending ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <SlidersHorizontal />
          )}
          Save settings
        </Button>
      </DialogFooter>
    </>
  )
}

function BackupStorageDialog({
  currentUserId,
  isPlatformAdmin,
  onOpenChange,
  open,
  storage,
}: {
  currentUserId: string
  isPlatformAdmin: boolean
  onOpenChange: (open: boolean) => void
  open: boolean
  storage: Array<BackupStorage>
}) {
  const [editor, setEditor] = React.useState<BackupStorage | "new" | null>(null)
  const [deleteCandidate, setDeleteCandidate] =
    React.useState<BackupStorage | null>(null)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="min-w-0 overflow-x-hidden sm:max-w-2xl">
          {editor ? (
            <BackupStorageEditor
              existing={editor === "new" ? null : editor}
              isPlatformAdmin={isPlatformAdmin}
              onBack={() => setEditor(null)}
            />
          ) : (
            <>
              <DialogHeader className="min-w-0">
                <DialogTitle>Backup destinations</DialogTitle>
                <DialogDescription>
                  Relay-local storage is always available. Add S3-compatible
                  destinations for off-node copies and signed downloads.
                </DialogDescription>
              </DialogHeader>
              <div className="min-w-0 space-y-2">
                <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-background/35 p-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border/70 bg-background text-muted-foreground">
                    <HardDrive className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold">
                      Local Relay storage
                    </span>
                    <span className="mt-0.5 block text-[0.625rem] text-muted-foreground">
                      Stored on the Relay that owns the resource
                    </span>
                  </span>
                  <Badge variant="outline">Built in</Badge>
                </div>
                {storage.map((destination) => {
                  const canManage =
                    isPlatformAdmin || destination.ownerUserId === currentUserId
                  return (
                    <div
                      key={destination.id}
                      className="flex items-center gap-3 rounded-lg border border-border/70 bg-background/35 p-3"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border/70 bg-background text-muted-foreground">
                        <Cloud className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-xs font-semibold">
                            {destination.name}
                          </span>
                          <Badge variant="outline">
                            {destination.ownerUserId === null
                              ? "Platform"
                              : "Personal"}
                          </Badge>
                          {!destination.enabled ? (
                            <Badge variant="outline">Disabled</Badge>
                          ) : null}
                        </span>
                        <span className="mt-1 block truncate font-mono text-[0.5625rem] text-muted-foreground">
                          {destination.endpoint} / {destination.bucket}
                          {destination.objectPrefix
                            ? ` / ${destination.objectPrefix}`
                            : ""}
                        </span>
                      </span>
                      {canManage ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <BackupActionButton
                            disabled={false}
                            icon={Pencil}
                            label={`Edit ${destination.name}`}
                            tooltip="Edit destination"
                            onClick={() => setEditor(destination)}
                          />
                          <BackupActionButton
                            disabled={false}
                            icon={Trash2}
                            label={`Delete ${destination.name}`}
                            tooltip="Delete destination"
                            onClick={() => setDeleteCandidate(destination)}
                          />
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
              <DialogFooter className="min-w-0">
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => onOpenChange(false)}
                >
                  Close
                </Button>
                <Button type="button" onClick={() => setEditor("new")}>
                  <Plus /> Add S3 destination
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      {deleteCandidate ? (
        <DeleteBackupStorageDialog
          destination={deleteCandidate}
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setDeleteCandidate(null)
          }}
        />
      ) : null}
    </>
  )
}

function BackupStorageEditor({
  existing,
  isPlatformAdmin,
  onBack,
}: {
  existing: BackupStorage | null
  isPlatformAdmin: boolean
  onBack: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = React.useState(existing?.name ?? "")
  const [endpoint, setEndpoint] = React.useState(existing?.endpoint ?? "")
  const [region, setRegion] = React.useState(existing?.region ?? "")
  const [bucket, setBucket] = React.useState(existing?.bucket ?? "")
  const [objectPrefix, setObjectPrefix] = React.useState(
    existing?.objectPrefix ?? ""
  )
  const [accessKeyId, setAccessKeyId] = React.useState("")
  const [secretAccessKey, setSecretAccessKey] = React.useState("")
  const [forcePathStyle, setForcePathStyle] = React.useState(
    existing?.forcePathStyle ?? false
  )
  const [allowPrivateNetwork, setAllowPrivateNetwork] = React.useState(
    existing?.allowPrivateNetwork ?? false
  )
  const [enabled, setEnabled] = React.useState(existing?.enabled ?? true)
  const [platform, setPlatform] = React.useState(existing?.ownerUserId === null)
  const save = useMutation({
    mutationFn: () =>
      saveBackupStorage({
        data: {
          ...(accessKeyId.trim() ? { accessKeyId: accessKeyId.trim() } : {}),
          allowPrivateNetwork,
          bucket: bucket.trim(),
          enabled,
          endpoint: endpoint.trim(),
          forcePathStyle,
          ...(existing ? { id: existing.id } : {}),
          name: name.trim(),
          objectPrefix: objectPrefix.trim(),
          platform,
          region: region.trim(),
          ...(secretAccessKey ? { secretAccessKey } : {}),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.backups.storage,
      })
      showToast({
        message: `${name.trim()} verified and saved`,
        type: "success",
      })
      onBack()
    },
  })
  const accessKeyProvided = Boolean(accessKeyId.trim())
  const secretKeyProvided = Boolean(secretAccessKey)
  const credentialsReady =
    accessKeyProvided === secretKeyProvided &&
    (existing !== null || (accessKeyProvided && secretKeyProvided))
  const canSave =
    Boolean(name.trim()) &&
    Boolean(endpoint.trim()) &&
    Boolean(region.trim()) &&
    Boolean(bucket.trim()) &&
    credentialsReady

  return (
    <>
      <DialogHeader>
        <div className="mb-1 flex items-center gap-2">
          <Button
            aria-label="Back to backup destinations"
            size="icon-sm"
            type="button"
            variant="ghost"
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
          <DialogTitle>
            {existing ? `Edit ${existing.name}` : "Add S3 destination"}
          </DialogTitle>
        </div>
        <DialogDescription>
          Credentials are encrypted by Hearth and verified before they are
          saved. Existing secrets are never sent back to the browser.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <StorageTextField label="Name" value={name} onChange={setName} />
        <StorageTextField
          label="Region"
          placeholder="us-east-1"
          value={region}
          onChange={setRegion}
        />
        <div className="sm:col-span-2">
          <StorageTextField
            label="Endpoint"
            placeholder="https://s3.example.com"
            value={endpoint}
            onChange={setEndpoint}
          />
        </div>
        <StorageTextField label="Bucket" value={bucket} onChange={setBucket} />
        <StorageTextField
          label="Object prefix"
          placeholder="kiln/backups"
          value={objectPrefix}
          onChange={setObjectPrefix}
        />
        <StorageTextField
          autoComplete="off"
          label="Access key ID"
          placeholder={existing ? "Leave blank to keep current key" : ""}
          value={accessKeyId}
          onChange={setAccessKeyId}
        />
        <StorageTextField
          autoComplete="new-password"
          label="Secret access key"
          placeholder={existing ? "Leave blank to keep current key" : ""}
          type="password"
          value={secretAccessKey}
          onChange={setSecretAccessKey}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <StorageSwitch
          checked={enabled}
          description="Allow new backups to select this destination."
          label="Enabled"
          onCheckedChange={setEnabled}
        />
        <StorageSwitch
          checked={forcePathStyle}
          description="Use endpoint/bucket/object addressing."
          label="Path-style URLs"
          onCheckedChange={setForcePathStyle}
        />
        {isPlatformAdmin ? (
          <StorageSwitch
            checked={allowPrivateNetwork}
            description="Permit private or loopback S3 endpoints."
            label="Private network"
            onCheckedChange={setAllowPrivateNetwork}
          />
        ) : null}
        {isPlatformAdmin ? (
          <StorageSwitch
            checked={platform}
            description="Available to every user and platform backup."
            disabled={existing !== null}
            label="Platform destination"
            onCheckedChange={setPlatform}
          />
        ) : null}
      </div>
      {save.error ? (
        <p className="text-xs text-destructive">{save.error.message}</p>
      ) : null}
      <DialogFooter>
        <Button variant="ghost" type="button" onClick={onBack}>
          Cancel
        </Button>
        <Button
          disabled={!canSave || save.isPending}
          type="button"
          onClick={() => save.mutate()}
        >
          {save.isPending ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <Cloud />
          )}
          Verify and save
        </Button>
      </DialogFooter>
    </>
  )
}

function StorageTextField({
  autoComplete,
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  autoComplete?: string
  label: string
  onChange: (value: string) => void
  placeholder?: string
  type?: React.HTMLInputTypeAttribute
  value: string
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium">{label}</span>
      <Input
        aria-label={label}
        autoComplete={autoComplete}
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  )
}

function StorageSwitch({
  checked,
  description,
  disabled = false,
  label,
  onCheckedChange,
}: {
  checked: boolean
  description: string
  disabled?: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/35 p-3">
      <span>
        <span className="block text-xs font-semibold">{label}</span>
        <span className="mt-0.5 block text-[0.625rem] leading-4 text-muted-foreground">
          {description}
        </span>
      </span>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </label>
  )
}

function DeleteBackupStorageDialog({
  destination,
  onOpenChange,
  open,
}: {
  destination: BackupStorage
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => deleteBackupStorage({ data: { id: destination.id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.backups.storage,
      })
      showToast({
        message: `${destination.name} deleted`,
        type: "success",
      })
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete destination?</DialogTitle>
          <DialogDescription>
            “{destination.name}” can only be deleted when no retained backups
            reference it. Objects already in the bucket are not removed.
          </DialogDescription>
        </DialogHeader>
        {remove.error ? (
          <p className="text-xs text-destructive">{remove.error.message}</p>
        ) : null}
        <DialogFooter>
          <Button
            variant="ghost"
            type="button"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={remove.isPending}
            type="button"
            variant="destructive"
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Trash2 />
            )}
            Delete destination
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RestoreBackupDialog({
  backup,
  onOpenChange,
  open,
  targetName,
}: {
  backup: Backup
  onOpenChange: (open: boolean) => void
  open: boolean
  targetName: string
}) {
  const queryClient = useQueryClient()
  const [safetyBackup, setSafetyBackup] = React.useState(true)
  const restore = useMutation({
    mutationFn: () =>
      backup.targetKind === "database"
        ? restoreDatabaseBackup({ data: { backupId: backup.id, safetyBackup } })
        : restoreInstanceBackup({
            data: { backupId: backup.id, safetyBackup },
          }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.backups.all })
      showToast({
        message: result.relayAccepted
          ? `Restore of ${targetName} queued`
          : `Restore saved and will resume when Relay reconnects`,
        type: result.relayAccepted ? "success" : "warning",
      })
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore {targetName}</DialogTitle>
          <DialogDescription>
            This replaces the target with “{backup.name}”. Game servers must be
            stopped; managed databases remain running for logical import.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-background/35 p-3">
          <span>
            <span className="block text-xs font-semibold">Safety backup</span>
            <span className="mt-1 block text-[0.625rem] leading-4 text-muted-foreground">
              Take a new full backup immediately before restoring.
            </span>
          </span>
          <Switch
            aria-label="Take a safety backup before restore"
            checked={safetyBackup}
            onCheckedChange={setSafetyBackup}
          />
        </label>
        {restore.error ? (
          <p className="text-xs text-destructive">{restore.error.message}</p>
        ) : null}
        <DialogFooter>
          <Button
            variant="ghost"
            type="button"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={restore.isPending}
            type="button"
            onClick={() => restore.mutate()}
          >
            {restore.isPending ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <RotateCcw />
            )}
            Restore backup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteBackupDialog({
  backup,
  onOpenChange,
  open,
}: {
  backup: Backup
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => deleteBackup({ data: { backupId: backup.id } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.backups.all })
      showToast({
        message: result.relayAccepted
          ? `${backup.name} queued for deletion`
          : `Deletion saved and will resume when Relay reconnects`,
        type: result.relayAccepted ? "success" : "warning",
      })
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete backup?</DialogTitle>
          <DialogDescription>
            “{backup.name}” and its stored artifact will be permanently removed.
          </DialogDescription>
        </DialogHeader>
        {remove.error ? (
          <p className="text-xs text-destructive">{remove.error.message}</p>
        ) : null}
        <DialogFooter>
          <Button
            variant="ghost"
            type="button"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={remove.isPending}
            type="button"
            variant="destructive"
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Trash2 />
            )}
            Delete backup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function backupScopeOptions({
  databases,
  includePlatform,
  nodes,
  servers,
}: {
  databases: Awaited<ReturnType<typeof getManagedDatabaseDirectory>>
  includePlatform: boolean
  nodes: ReturnType<typeof selectBackupScope>["nodes"]
  servers: ReturnType<typeof selectBackupScope>["servers"]
}): Array<ServerPickerOption> {
  const options: Array<ServerPickerOption> = []
  for (const server of servers) {
    options.push({
      description: `Server · ${server.relayName} · ${server.id}`,
      id: server.id,
      kind: "server",
      name: server.name,
      relayId: server.relayId,
      relayName: server.relayName,
    })
  }
  for (const database of databases) {
    options.push({
      description: `Database · ${database.relayName} · ${database.id}`,
      id: database.id,
      kind: "database",
      name: database.name,
      relayId: database.relayId,
      relayName: database.relayName,
    })
  }
  if (includePlatform) {
    for (const node of nodes) {
      options.push({
        description: `Relay · ${node.relayId}`,
        id: node.relayId,
        kind: "relay",
        name: node.relayName,
        relayId: node.relayId,
        relayName: node.relayName,
      })
    }
  }
  return options
}

function backupMatchesScope(
  backup: Backup,
  selected: ServerPickerOption | null
): boolean {
  if (!selected) return true
  const kind = selected.kind ?? "server"
  if (kind === "server") {
    return (
      backup.targetKind === "instance" &&
      backup.relayId === selected.relayId &&
      backup.targetId === selected.id
    )
  }
  if (kind === "database") {
    return (
      backup.targetKind === "database" &&
      backup.relayId === selected.relayId &&
      backup.targetId === selected.id
    )
  }
  return backup.targetKind === "platform" && backup.relayId === selected.relayId
}

function selectedBackupCreateTargetKey(selected: ServerPickerOption): string {
  const kind = selected.kind ?? "server"
  if (kind === "database") {
    return targetKey("database", selected.relayId, selected.id)
  }
  if (kind === "relay") {
    return targetKey("platform", selected.relayId, "kiln")
  }
  return targetKey("instance", selected.relayId, selected.id)
}

function availableCreateTargets({
  capabilities,
  databases,
  nodes,
  servers,
}: {
  capabilities: Awaited<ReturnType<typeof getAccessCapabilities>>
  databases: Awaited<ReturnType<typeof getManagedDatabaseDirectory>>
  nodes: ReturnType<typeof selectBackupScope>["nodes"]
  servers: ReturnType<typeof selectBackupScope>["servers"]
}): Array<CreateTarget> {
  const targets: Array<CreateTarget> = []
  for (const server of servers) {
    if (
      canCreateForResource(capabilities, server.relayId, "instance", server.id)
    ) {
      targets.push({
        id: server.id,
        key: targetKey("instance", server.relayId, server.id),
        kind: "instance",
        name: server.name,
        relayId: server.relayId,
        relayName: server.relayName,
      })
    }
  }
  for (const database of databases) {
    if (!database.supportsImportExport) continue
    if (
      canCreateForResource(
        capabilities,
        database.relayId,
        "database",
        database.id
      )
    ) {
      targets.push({
        id: database.id,
        key: targetKey("database", database.relayId, database.id),
        kind: "database",
        name: database.name,
        relayId: database.relayId,
        relayName: database.relayName,
      })
    }
  }
  if (capabilities.isPlatformAdmin) {
    for (const relay of nodes) {
      targets.push({
        id: relay.relayId,
        key: targetKey("platform", relay.relayId, "kiln"),
        kind: "platform",
        name: "Kiln platform",
        relayId: relay.relayId,
        relayName: relay.relayName,
      })
    }
  }
  return targets
}

function canCreateForResource(
  capabilities: Awaited<ReturnType<typeof getAccessCapabilities>>,
  relayId: string,
  resourceType: "database" | "instance",
  resourceId: string
): boolean {
  if (capabilities.isPlatformAdmin) return true
  return capabilities.grants.some(
    (grant) =>
      grant.relayId === relayId &&
      roleHasPermission(grant.role, "backup.create") &&
      (grant.resourceType === "relay" ||
        (grant.resourceType === resourceType &&
          grant.resourceId === resourceId))
  )
}

function backupIsActive(backup: Backup): boolean {
  return (
    backupSourceIsActive(backup) ||
    backup.artifacts.some((artifact) => activeStatuses.has(artifact.status))
  )
}

function backupSourceIsActive(backup: Backup): boolean {
  return (
    activeStatuses.has(backup.status) ||
    (backup.status === "available" &&
      (backup.taskStatus === "queued" || backup.taskStatus === "running"))
  )
}

function backupMatchesStatusFilter(
  backup: Backup,
  status: BackupFilters["status"]
): boolean {
  if (!status) return true
  const active = backupIsActive(backup)
  if (status === "active") return active
  const failed =
    backup.status === "failed" ||
    backup.artifacts.some((artifact) => artifact.status === "failed")
  if (status === "failed") return !active && failed
  return !active && !failed && backup.status === "available"
}

function backupTargetName(
  backup: Backup,
  targetNames: ReadonlyMap<string, string>
): string {
  if (backup.targetKind === "platform") return "Kiln platform"
  return (
    targetNames.get(
      targetKey(backup.targetKind, backup.relayId, backup.targetId)
    ) ?? backup.targetId
  )
}

function backupTargetPresentation(
  backup: Backup,
  relayName: string,
  targetName: string
): BackupTargetPresentation {
  if (backup.targetKind === "platform") {
    return {
      id: backup.relayId,
      kindLabel: "Relay",
      name: relayName,
    }
  }
  const shortId = backup.targetId.slice(0, 8)
  return {
    id: backup.targetId,
    kindLabel: backup.targetKind === "database" ? "Database" : "Server",
    name: targetName === backup.targetId ? shortId : targetName,
  }
}

function missingTargetMessage(kind: Backup["targetKind"]): string {
  if (kind === "database") return "This database no longer exists"
  if (kind === "platform") return "This Relay no longer exists"
  return "This server no longer exists"
}

function backupAvailabilityTags(
  backup: Backup,
  destinations: ReadonlyArray<BackupAvailabilityDestination>
): Array<BackupAvailabilityTagView> {
  const artifactsByStorage = new Map<string, Backup["artifacts"][number]>()
  for (const artifact of backup.artifacts) {
    artifactsByStorage.set(artifact.storageId ?? "local", artifact)
  }
  const tags: Array<BackupAvailabilityTagView> = destinations.map(
    (destination) => {
      const key = destination.id ?? "local"
      const artifact = artifactsByStorage.get(key)
      return {
        error: artifact?.error ?? null,
        key,
        label: destination.id ? destination.name : "Local",
        name: destination.id ? destination.name : "Local Relay",
        state: artifactAvailabilityState(artifact?.status),
      }
    }
  )
  const seen = new Set(tags.map((tag) => tag.key))
  for (const artifact of backup.artifacts) {
    const key = artifact.storageId ?? "local"
    if (seen.has(key)) continue
    tags.push({
      error: artifact.error,
      key,
      label: artifact.storageId ? "S3" : "Local",
      name: artifact.storageId ? "S3 destination" : "Local Relay",
      state: artifactAvailabilityState(artifact.status),
    })
  }
  const s3Enabled =
    destinations.some((destination) => destination.id !== null) ||
    backup.artifacts.some((artifact) => artifact.storageId !== null)
  if (!s3Enabled) {
    tags.push({
      error: null,
      key: "s3",
      label: "S3",
      name: "S3",
      state: "missing",
      tooltip: "S3 not configured",
    })
  }
  return tags
}

function extraBackupDestinations(
  backup: Backup,
  currentUserId: string,
  destinations: ReadonlyArray<BackupAvailabilityDestination>
): Array<BackupAvailabilityDestination & { id: string }> {
  return destinations.flatMap((destination) => {
    if (
      !destination.enabled ||
      !destination.id ||
      (backup.targetKind === "platform"
        ? destination.ownerUserId !== null
        : destination.ownerUserId !== null &&
          destination.ownerUserId !== currentUserId)
    ) {
      return []
    }
    const artifact = backup.artifacts.find(
      (candidate) => candidate.storageId === destination.id
    )
    if (
      artifact &&
      (artifact.status === "available" ||
        artifact.status === "queued" ||
        artifact.status === "running")
    ) {
      return []
    }
    return [{ ...destination, id: destination.id }]
  })
}

function backupCopyDisabledReason(
  backup: Backup,
  canCopy: boolean,
  destinations: ReadonlyArray<BackupAvailabilityDestination>,
  extraDestinations: ReadonlyArray<BackupAvailabilityDestination>
): string | null {
  if (!canCopy) return "You do not have permission to copy this backup"
  const hasAvailableFile = backup.artifacts.some(
    (artifact) => artifact.status === "available"
  )
  const s3Configured = destinations.some(
    (destination) => destination.enabled && destination.id !== null
  )
  if (!hasAvailableFile) {
    return "A successful backup file is required before copying to another destination"
  }
  if (!s3Configured) return "S3 not configured"
  if (extraDestinations.length === 0) {
    return "Already stored on every destination"
  }
  return null
}

function artifactAvailabilityState(
  status: Backup["artifacts"][number]["status"] | undefined
): BackupAvailabilityState {
  if (status === "available") return "available"
  if (status === "failed") return "failed"
  if (status === "queued" || status === "running" || status === "deleting") {
    return "working"
  }
  return "missing"
}

function availabilityTagClassName(state: BackupAvailabilityState): string {
  if (state === "available") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  }
  if (state === "working") {
    return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
  }
  if (state === "failed") {
    return "border-destructive/30 bg-destructive/10 text-destructive"
  }
  return "border-border/70 bg-muted/40 text-muted-foreground"
}

function availabilityStateLabel(state: BackupAvailabilityState): string {
  if (state === "available") return "Available"
  if (state === "working") return "Copying"
  if (state === "failed") return "Failed"
  return "Not stored here"
}

function targetKey(
  kind: "database" | "instance" | "platform",
  relayId: string,
  targetId: string
): string {
  return `${kind}:${relayId}:${targetId}`
}

function targetKindLabel(kind: CreateTarget["kind"]): string {
  if (kind === "database") return "Database"
  if (kind === "platform") return "Platform"
  return "Server"
}

function backupStatusFilterLabel(status: BackupFilters["status"]): string {
  return (
    backupStatusFilterOptions.find((option) => option.value === status)
      ?.label ?? "All statuses"
  )
}

function subscribeToMobileBackupLayout(onChange: () => void): () => void {
  const media = window.matchMedia(mobileBackupLayoutQuery)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

function getMobileBackupLayoutSnapshot(): boolean {
  return window.matchMedia(mobileBackupLayoutQuery).matches
}

function getServerMobileBackupLayoutSnapshot(): boolean {
  return false
}

function backupRowKey(backup: Backup) {
  return backup.id
}

function backupSearchText(backup: Backup): string {
  return [
    backup.name,
    backup.filename,
    backup.id,
    backup.targetId,
    backup.targetKind,
    backup.status,
    backup.relayId,
    ...backup.artifacts.map((artifact) =>
      artifact.storageId ? "s3" : "local"
    ),
  ]
    .filter(Boolean)
    .join(" ")
}

function shortRelativeBackupTime(timestamp: number): string | null {
  const elapsed = Math.max(0, Date.now() - timestamp)
  if (elapsed < backupMinuteMs) return "just now"
  if (elapsed < backupHourMs) {
    return `${Math.floor(elapsed / backupMinuteMs)}m ago`
  }
  if (elapsed < backupDayMs) {
    return `${Math.floor(elapsed / backupHourMs)}h ago`
  }
  if (elapsed < 7 * backupDayMs) {
    return `${Math.floor(elapsed / backupDayMs)}d ago`
  }
  return null
}

function parseOptionalInteger(value: string, label: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a whole number of zero or more`)
  }
  return parsed
}

function parseOptionalGiB(value: string, label: string): number | null {
  if (!value.trim()) return null
  const gibibytes = Number(value)
  const bytes = Math.round(gibibytes * 1024 ** 3)
  if (
    !Number.isFinite(gibibytes) ||
    gibibytes < 0 ||
    !Number.isSafeInteger(bytes)
  ) {
    throw new Error(`${label} must be a non-negative size`)
  }
  return bytes
}

function bytesToGiBInput(bytes: number | null): string {
  if (bytes === null) return ""
  return (bytes / 1024 ** 3).toString()
}

function excludeLines(value: string): Array<string> {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KiB", "MiB", "GiB", "TiB"]
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}
