import * as React from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import {
  Archive,
  ArrowLeft,
  Check,
  CircleCheck,
  CircleX,
  Cloud,
  CloudCog,
  Copy,
  Database,
  Download,
  HardDrive,
  History as RotateCcwClock,
  LoaderCircle,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
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
  deleteBackup,
  getBackupDownloadUrl,
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
type BackupDialog =
  | { backup: Backup; kind: "delete" }
  | { backup: Backup; kind: "download" }
  | { backup: Backup; kind: "restore" }
  | null

export interface BackupFilters {
  relay?: string
  search?: string
  server?: string
  status?: "active" | "available" | "failed"
}

type BackupSearchStore = WorkspaceTableSearchStore

interface CreateTarget {
  id: string
  key: string
  kind: "database" | "instance" | "platform"
  name: string
  relayId: string
  relayName: string
}

const activeStatuses = new Set(["queued", "running", "deleting"])
const backupDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})
const backupMinuteMs = 60_000
const backupHourMs = 60 * backupMinuteMs
const backupDayMs = 24 * backupHourMs
const subscribeToBrowser = () => () => undefined

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
  const { data: snapshot } = useSuspenseQuery(relaySnapshotQueryOptions())
  const { data: databases } = useSuspenseQuery(
    managedDatabaseDirectoryQueryOptions()
  )
  const { data: capabilities } = useSuspenseQuery(
    accessCapabilitiesQueryOptions()
  )
  const [createOpen, setCreateOpen] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [storageOpen, setStorageOpen] = React.useState(false)
  const [dialog, setDialog] = React.useState<BackupDialog>(null)

  const servers = React.useMemo<Array<ServerPickerOption>>(
    () =>
      snapshot.instances.map((instance) => ({
        id: instance.id,
        name: instance.name,
        relayId: instance.relayId,
        relayName: instance.relayName,
      })),
    [snapshot.instances]
  )
  const selectedServer = React.useMemo(
    () =>
      servers.find(
        (server) =>
          server.id === filters.server && server.relayId === filters.relay
      ) ?? null,
    [filters.relay, filters.server, servers]
  )
  const selectServer = React.useCallback(
    (server: ServerPickerOption | null) => {
      onFiltersChange({ relay: server?.relayId, server: server?.id })
    },
    [onFiltersChange]
  )
  const targetNames = React.useMemo(() => {
    const names = new Map<string, string>()
    for (const server of servers) {
      names.set(targetKey("instance", server.relayId, server.id), server.name)
    }
    for (const database of databases) {
      names.set(
        targetKey("database", database.relayId, database.id),
        database.name
      )
    }
    return names
  }, [databases, servers])
  const relayNames = React.useMemo(
    () =>
      new Map([
        ...snapshot.nodes.map(
          (relay) => [relay.relayId, relay.relayName] as const
        ),
        ...snapshot.instances.map(
          (instance) => [instance.relayId, instance.relayName] as const
        ),
      ]),
    [snapshot.instances, snapshot.nodes]
  )
  const storageNames = React.useMemo(
    () =>
      new Map(storage.map((destination) => [destination.id, destination.name])),
    [storage]
  )
  const filteredBackups = React.useMemo(
    () =>
      backups.filter((backup) => {
        if (backup.status === "deleted") return false
        if (
          selectedServer &&
          (backup.targetKind !== "instance" ||
            backup.relayId !== selectedServer.relayId ||
            backup.targetId !== selectedServer.id)
        ) {
          return false
        }
        if (filters.status === "active") return backupIsActive(backup)
        if (filters.status === "available") return backup.status === "available"
        if (filters.status === "failed") return backup.status === "failed"
        return true
      }),
    [backups, filters.status, selectedServer]
  )
  const createTargets = React.useMemo(
    () =>
      availableCreateTargets({
        capabilities,
        databases,
        nodes: snapshot.nodes,
        servers: snapshot.instances,
      }),
    [capabilities, databases, snapshot.instances, snapshot.nodes]
  )
  const selectedCreateTargetKey = selectedServer
    ? targetKey("instance", selectedServer.relayId, selectedServer.id)
    : undefined
  const canManageSelectedServer = selectedServer
    ? createTargets.some(
        (target) =>
          target.kind === "instance" &&
          target.relayId === selectedServer.relayId &&
          target.id === selectedServer.id
      )
    : false
  const openDialog = React.useCallback((next: BackupDialog) => {
    setDialog(next)
  }, [])

  return (
    <div className="mx-auto flex h-full min-h-[34rem] w-full max-w-[90rem] flex-col px-3 pt-3 pb-3 sm:px-5 sm:pt-5 sm:pb-5">
      <ServerScopePicker
        selectedServer={selectedServer}
        servers={servers}
        onSelect={selectServer}
      />

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card/45 [contain:paint]">
        <BackupToolbar
          canCreate={createTargets.length > 0}
          filters={filters}
          searchStore={searchStore}
          onCreate={() => setCreateOpen(true)}
          onFiltersChange={onFiltersChange}
          onManageSettings={() => setSettingsOpen(true)}
          onManageStorage={() => setStorageOpen(true)}
          canManageSettings={canManageSelectedServer}
        />
        <div className="min-h-0 flex-1 overflow-auto">
          <BackupTable
            backups={filteredBackups}
            filtered={Boolean(selectedServer || filters.status)}
            relayNames={relayNames}
            searchStore={searchStore}
            storageNames={storageNames}
            targetNames={targetNames}
            onDialog={openDialog}
          />
        </div>
      </section>

      {createOpen ? (
        <CreateBackupDialog
          initialTargetKey={selectedCreateTargetKey}
          open
          storage={storage}
          targets={createTargets}
          onOpenChange={setCreateOpen}
        />
      ) : null}
      {storageOpen ? (
        <BackupStorageDialog
          currentUserId={capabilities.user.id}
          isPlatformAdmin={capabilities.isPlatformAdmin}
          open
          storage={storage}
          onOpenChange={setStorageOpen}
        />
      ) : null}
      {settingsOpen && selectedServer ? (
        <InstanceBackupSettingsDialog
          isPlatformAdmin={capabilities.isPlatformAdmin}
          open
          server={selectedServer}
          storage={storage}
          onOpenChange={setSettingsOpen}
        />
      ) : null}
      {dialog?.kind === "restore" ? (
        <RestoreBackupDialog
          backup={dialog.backup}
          targetName={backupTargetName(dialog.backup, targetNames)}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
        />
      ) : null}
      {dialog?.kind === "download" ? (
        <DownloadBackupDialog
          backup={dialog.backup}
          open
          storageNames={storageNames}
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <DeleteBackupDialog
          backup={dialog.backup}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
        />
      ) : null}
    </div>
  )
})

const BackupToolbar = React.memo(function BackupToolbar({
  canCreate,
  canManageSettings,
  filters,
  onCreate,
  onFiltersChange,
  onManageSettings,
  onManageStorage,
  searchStore,
}: {
  canCreate: boolean
  canManageSettings: boolean
  filters: BackupFilters
  onCreate: () => void
  onFiltersChange: (change: Partial<BackupFilters>) => void
  onManageSettings: () => void
  onManageStorage: () => void
  searchStore: BackupSearchStore
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [mobileSearchOpen, setMobileSearchOpen] = React.useState(
    () => searchStore.getSnapshot().length > 0
  )
  const { fetchStatus, refetch } = useQuery({
    ...backupsQueryOptions(),
    notifyOnChangeProps: ["fetchStatus"],
  })
  const browserReady = React.useSyncExternalStore(
    subscribeToBrowser,
    () => true,
    () => false
  )
  const syncing = browserReady && fetchStatus === "fetching"
  useWorkspaceTableSearchInput(inputRef, searchStore)

  React.useEffect(() => {
    if (mobileSearchOpen) inputRef.current?.focus()
  }, [mobileSearchOpen])

  return (
    <div className="flex min-w-0 items-center gap-2 border-b bg-background/25 p-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Manage selected server backup settings"
            className={`${mobileSearchOpen ? "hidden sm:inline-flex" : "inline-flex"} shrink-0`}
            disabled={!canManageSettings}
            size="icon"
            type="button"
            variant="outline"
            onClick={onManageSettings}
          >
            <SlidersHorizontal />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {canManageSettings
            ? "Server backup settings"
            : "Choose a server to manage its backup settings"}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Sync backups"
            aria-busy={syncing}
            disabled={syncing}
            size="icon"
            type="button"
            variant="outline"
            onClick={() => void refetch()}
          >
            <RefreshCw className={syncing ? "animate-spin" : ""} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Sync backups</TooltipContent>
      </Tooltip>

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
      <select
        aria-label="Filter backups by status"
        className={`${mobileSearchOpen ? "hidden sm:block" : "block"} h-9 rounded-lg border border-input bg-transparent px-3 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`}
        value={filters.status ?? ""}
        onChange={(event) =>
          onFiltersChange({
            status:
              event.currentTarget.value === "active" ||
              event.currentTarget.value === "available" ||
              event.currentTarget.value === "failed"
                ? event.currentTarget.value
                : undefined,
          })
        }
      >
        <option value="">All statuses</option>
        <option value="active">In progress</option>
        <option value="available">Available</option>
        <option value="failed">Failed</option>
      </select>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Manage backup destinations"
            className={`${mobileSearchOpen ? "hidden sm:inline-flex" : "inline-flex"} shrink-0`}
            type="button"
            variant="outline"
            onClick={onManageStorage}
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
            aria-label="New backup"
            className={`${mobileSearchOpen ? "hidden sm:inline-flex" : "inline-flex"} shrink-0`}
            disabled={!canCreate}
            type="button"
            onClick={onCreate}
          >
            <Plus /> <span className="hidden sm:inline">New backup</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">New backup</TooltipContent>
      </Tooltip>
    </div>
  )
})

const BackupTable = React.memo(function BackupTable({
  backups,
  filtered,
  onDialog,
  relayNames,
  searchStore,
  storageNames,
  targetNames,
}: {
  backups: Array<Backup>
  filtered: boolean
  onDialog: (dialog: BackupDialog) => void
  relayNames: ReadonlyMap<string, string>
  searchStore: BackupSearchStore
  storageNames: ReadonlyMap<string, string>
  targetNames: ReadonlyMap<string, string>
}) {
  const renderRow = React.useCallback(
    (backup: Backup) => (
      <BackupTableRow
        backup={backup}
        relayName={relayNames.get(backup.relayId) ?? backup.relayId}
        storageNames={storageNames}
        targetAvailable={
          backup.targetKind === "platform" ||
          targetNames.has(
            targetKey(backup.targetKind, backup.relayId, backup.targetId)
          )
        }
        targetName={backupTargetName(backup, targetNames)}
        onDialog={onDialog}
      />
    ),
    [onDialog, relayNames, storageNames, targetNames]
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
    <WorkspaceDataTable
      getRowKey={backupRowKey}
      getSearchText={backupSearchText}
      head={<BackupTableHead />}
      items={backups}
      renderEmpty={renderEmpty}
      renderRow={renderRow}
      searchStore={searchStore}
    />
  )
})

const BackupTableHead = React.memo(function BackupTableHead() {
  return (
    <WorkspaceTableHead className="sticky top-0 z-20 bg-background/95 shadow-[0_1px_0_var(--border)] backdrop-blur">
      <WorkspaceTableHeading className="w-14">
        <span className="sr-only">Status</span>
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="w-auto sm:w-[27%]">
        Backup
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="hidden w-[20%] md:table-cell">
        Target
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="hidden w-[14%] lg:table-cell">
        Destinations
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="hidden w-24 xl:table-cell">
        Size
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="hidden w-28 sm:table-cell">
        Created
      </WorkspaceTableHeading>
      <WorkspaceTableHeading className="w-48 text-right">
        Actions
      </WorkspaceTableHeading>
    </WorkspaceTableHead>
  )
})

const BackupTableRow = React.memo(function BackupTableRow({
  backup,
  onDialog,
  relayName,
  storageNames,
  targetAvailable,
  targetName,
}: {
  backup: Backup
  onDialog: (dialog: BackupDialog) => void
  relayName: string
  storageNames: ReadonlyMap<string, string>
  targetAvailable: boolean
  targetName: string
}) {
  const canRestore =
    backup.status === "available" &&
    !backupIsActive(backup) &&
    targetAvailable &&
    (backup.targetKind === "instance" || backup.targetKind === "database")
  const canDownload = backup.status === "available"

  return (
    <tr className="group transition-colors hover:bg-muted/20">
      <WorkspaceTableCell>
        <BackupStatusBadge backup={backup} />
      </WorkspaceTableCell>
      <WorkspaceTableCell>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{backup.name}</p>
          <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">
            {backup.filename ?? backup.id}
          </p>
          {backup.taskError ? (
            <p className="mt-1 line-clamp-1 text-[10px] text-destructive">
              {backup.taskError}
            </p>
          ) : null}
        </div>
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden md:table-cell">
        <div className="flex min-w-0 items-center gap-2">
          <BackupTargetIcon kind={backup.targetKind} />
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium">
              {targetName}
            </span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {relayName}
            </span>
          </span>
        </div>
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden lg:table-cell">
        <div className="flex flex-wrap items-center gap-1.5">
          {backup.artifacts.map((artifact) => (
            <BackupDestinationTag
              key={artifact.id}
              artifact={artifact}
              storageName={
                artifact.storageId
                  ? (storageNames.get(artifact.storageId) ?? "S3 destination")
                  : "Local Relay"
              }
            />
          ))}
        </div>
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden font-mono text-[10px] text-muted-foreground xl:table-cell">
        {backup.bytes === null ? "—" : formatBytes(backup.bytes)}
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden text-[10px] whitespace-nowrap text-muted-foreground sm:table-cell">
        <BackupCreatedTime createdAt={backup.createdAt} />
      </WorkspaceTableCell>
      <WorkspaceTableCell className="text-right">
        <div className="flex items-center justify-end gap-0.5">
          <Button
            aria-label={`Restore ${backup.name}`}
            className="h-8 px-2.5 text-xs"
            disabled={!canRestore}
            size="sm"
            type="button"
            variant="outline"
            onClick={() => onDialog({ backup, kind: "restore" })}
          >
            <RotateCcwClock /> Restore
          </Button>
          <BackupActionButton
            disabled={!canDownload}
            icon={Download}
            label={`Download ${backup.name}`}
            tooltip="Download or create a link"
            onClick={() => onDialog({ backup, kind: "download" })}
          />
          <BackupActionButton
            disabled={backupIsActive(backup)}
            icon={Trash2}
            label={`Delete ${backup.name}`}
            tooltip="Delete backup"
            onClick={() => onDialog({ backup, kind: "delete" })}
          />
        </div>
      </WorkspaceTableCell>
    </tr>
  )
})

function BackupStatusBadge({ backup }: { backup: Backup }) {
  const details = backupStatusDetails(backup)
  const Icon = backupIsActive(backup)
    ? LoaderCircle
    : backup.status === "available"
      ? CircleCheck
      : backup.status === "failed"
        ? TriangleAlert
        : CircleX
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={details.label}
          className={`grid size-7 place-items-center rounded-full border ${details.className}`}
          role="img"
        >
          <Icon
            className={`size-4 ${backupIsActive(backup) ? "animate-spin" : ""}`}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{details.label}</TooltipContent>
    </Tooltip>
  )
}

function BackupDestinationTag({
  artifact,
  storageName,
}: {
  artifact: Backup["artifacts"][number]
  storageName: string
}) {
  const available = artifact.status === "available"
  const active = artifact.status === "queued" || artifact.status === "running"
  const label = artifact.storageId ? "S3" : "Local"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex h-6 items-center gap-1 rounded-md border px-2 font-mono text-[9px] font-semibold uppercase ${
            available
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : active
                ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {active ? (
            <LoaderCircle className="size-2.5 animate-spin" />
          ) : available ? (
            <Check className="size-2.5" />
          ) : null}
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {storageName} · {artifactStatusLabel(artifact.status)}
        {artifact.error ? ` · ${artifact.error}` : ""}
      </TooltipContent>
    </Tooltip>
  )
}

function BackupCreatedTime({ createdAt }: { createdAt: string }) {
  const timestamp = new Date(createdAt).getTime()
  const relative = shortRelativeBackupTime(timestamp)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time
          className="block cursor-help truncate font-mono text-[10px]"
          dateTime={createdAt}
          suppressHydrationWarning
        >
          {relative ?? backupDate.format(timestamp)}
        </time>
      </TooltipTrigger>
      <TooltipContent side="top">
        <span suppressHydrationWarning>{backupDate.format(timestamp)}</span>
      </TooltipContent>
    </Tooltip>
  )
}

function BackupTargetIcon({ kind }: { kind: Backup["targetKind"] }) {
  const Icon =
    kind === "database" ? Database : kind === "platform" ? ShieldCheck : Server
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border/70 bg-background/60 text-muted-foreground">
      <Icon className="size-3.5" />
    </span>
  )
}

function BackupActionButton({
  disabled,
  icon: Icon,
  label,
  onClick,
  spinning = false,
  tooltip,
}: {
  disabled: boolean
  icon: typeof Download
  label: string
  onClick: () => void
  spinning?: boolean
  tooltip: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          disabled={disabled}
          size="icon-sm"
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
              <p className="font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
                Destination
              </p>
              <p className="mt-1 truncate text-sm font-medium">
                {artifact?.storageId
                  ? (storageNames.get(artifact.storageId) ?? "S3")
                  : "Local Relay"}
              </p>
            </div>
            <div>
              <p className="font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
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
            <p className="mt-2 text-[10px] text-muted-foreground">
              Links can remain valid from 1 minute up to 7 days.
            </p>
            {shared ? (
              <div className="mt-3 flex gap-2">
                <Input
                  aria-label="Generated temporary backup URL"
                  className="font-mono text-[10px]"
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
        <span className="block truncate text-[10px] text-muted-foreground">
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
  const [name, setName] = React.useState("Manual backup")
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
            <span className="mt-1.5 block text-[10px] text-muted-foreground">
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
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 p-3 text-[10px] leading-4 text-muted-foreground sm:col-span-2">
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
          <span className="mt-1.5 block text-[10px] text-muted-foreground">
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
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
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
                        <span className="mt-1 block truncate font-mono text-[9px] text-muted-foreground">
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
        <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
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
            <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
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

function availableCreateTargets({
  capabilities,
  databases,
  nodes,
  servers,
}: {
  capabilities: Awaited<ReturnType<typeof getAccessCapabilities>>
  databases: Awaited<ReturnType<typeof getManagedDatabaseDirectory>>
  nodes: Awaited<ReturnType<typeof getRelaySnapshot>>["nodes"]
  servers: Awaited<ReturnType<typeof getRelaySnapshot>>["instances"]
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

function backupStatusDetails(backup: Backup): {
  className: string
  label: string
} {
  const { status } = backup
  if (
    status === "available" &&
    (backup.taskStatus === "queued" || backup.taskStatus === "running")
  ) {
    return {
      className:
        "border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-300",
      label: "Restoring",
    }
  }
  if (status === "available") {
    return {
      className:
        "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      label: "Available",
    }
  }
  if (status === "failed") {
    return {
      className: "border-destructive/40 bg-destructive/10 text-destructive",
      label: "Failed",
    }
  }
  if (status === "deleting") {
    return {
      className:
        "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300",
      label: "Deleting",
    }
  }
  return {
    className:
      "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    label: status === "queued" ? "Queued" : "Running",
  }
}

function backupIsActive(backup: Backup): boolean {
  return (
    activeStatuses.has(backup.status) ||
    (backup.status === "available" &&
      (backup.taskStatus === "queued" || backup.taskStatus === "running"))
  )
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
    ...backup.artifacts.map((artifact) =>
      artifact.storageId ? "s3" : "local"
    ),
  ]
    .filter(Boolean)
    .join(" ")
}

function artifactStatusLabel(
  status: Backup["artifacts"][number]["status"]
): string {
  if (status === "available") return "Available"
  if (status === "failed") return "Failed"
  if (status === "deleting") return "Deleting"
  if (status === "deleted") return "Deleted"
  return status === "queued" ? "Queued" : "Running"
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
