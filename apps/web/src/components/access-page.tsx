import * as React from "react"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Effect } from "effect"
import {
  Activity,
  ChevronDown,
  Clock3,
  Database,
  ListFilter,
  LoaderCircle,
  Network,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
  UserRound,
  Users,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { showToast } from "@workspace/ui/components/sonner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import {
  ServerPickerList,
  serverPickerOptionKey,
} from "@/components/server-picker-list"
import type { ServerPickerOption } from "@/components/server-picker-list"
import {
  WorkspaceDataTable,
  WorkspaceTableCell,
  WorkspaceTableHead,
  WorkspaceTableHeading,
  createWorkspaceTableSearchStore,
  useWorkspaceTableSearchInput,
} from "@/components/workspace-data-table"
import type { WorkspaceTableSearchStore } from "@/components/workspace-data-table"
import type { FleetRelayInstance } from "@/lib/relay-fleet"
import type { AccessRole } from "@/lib/permissions"
import { accessRoleDetails, accessRoles, isAccessRole } from "@/lib/permissions"
import {
  accessOverviewQueryOptions,
  managedDatabaseDirectoryQueryOptions,
  queryKeys,
} from "@/lib/query-options"
import {
  getAccessOverview,
  grantOrInviteAccess,
  removeAccessGrant,
  revokeAccessInvitation,
  updateAccessGrant,
} from "@/server/access"
import type { getManagedDatabaseDirectory } from "@/server/databases"

type AccessOverview = Awaited<ReturnType<typeof getAccessOverview>>
type AccessGrant = AccessOverview["grants"][number]
type AccessOwner = AccessOverview["owners"][number]
type ManagedDatabaseDirectory = Awaited<
  ReturnType<typeof getManagedDatabaseDirectory>
>

interface AccessTarget extends ServerPickerOption {
  databaseId: string | null
  instanceId: string | null
  resourceName: string
}

interface AccessDirectoryRow {
  createdAt: string
  email: string
  grant: AccessGrant | null
  instanceId: string | null
  instanceOwner: boolean
  key: string
  platformAdministrator: boolean
  relayId: string
  relayName: string
  resourceId: string
  resourceName: string
  resourceType: "database" | "instance" | "relay"
  role: AccessRole
  userId: string
}

interface RemoveTarget {
  email: string
  grantId: string
  relayId: string
  resourceName: string
}

interface AccessFilters {
  relayId: string
  resourceType: "" | AccessDirectoryRow["resourceType"]
  role: "" | AccessRole
}

const emptyAccessFilters: AccessFilters = {
  relayId: "",
  resourceType: "",
  role: "",
}

const invitationExpiryFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeZone: "UTC",
})

export function AccessPage({
  instances,
}: {
  instances: Array<FleetRelayInstance>
}) {
  const queryClient = useQueryClient()
  const { data: overview } = useSuspenseQuery(accessOverviewQueryOptions())
  const { data: databases } = useSuspenseQuery(
    managedDatabaseDirectoryQueryOptions()
  )
  const [searchStore] = React.useState(createWorkspaceTableSearchStore)
  const [addOpen, setAddOpen] = React.useState(false)
  const [pendingOpen, setPendingOpen] = React.useState(false)
  const [filters, setFilters] =
    React.useState<AccessFilters>(emptyAccessFilters)
  const [removeTarget, setRemoveTarget] = React.useState<RemoveTarget | null>(
    null
  )
  const ownerRelayIds = React.useMemo(
    () => new Set(overview.ownerRelayIds),
    [overview.ownerRelayIds]
  )
  const targets = React.useMemo(
    () => accessTargets(overview, instances, databases),
    [databases, instances, overview]
  )
  const rows = React.useMemo(
    () => accessDirectoryRows(overview, instances, databases),
    [databases, instances, overview]
  )
  const filteredRows = React.useMemo(
    () =>
      rows.filter(
        (row) =>
          (!filters.relayId || row.relayId === filters.relayId) &&
          (!filters.resourceType ||
            row.resourceType === filters.resourceType) &&
          (!filters.role || row.role === filters.role)
      ),
    [filters, rows]
  )
  const activeFilterCount =
    Number(Boolean(filters.relayId)) +
    Number(Boolean(filters.resourceType)) +
    Number(Boolean(filters.role))
  const updateFilters = React.useCallback(
    (change: Partial<AccessFilters>) =>
      setFilters((current) => ({ ...current, ...change })),
    []
  )
  const openAddDialog = React.useCallback(() => setAddOpen(true), [])
  const openPendingDialog = React.useCallback(() => setPendingOpen(true), [])

  const updateGrantMutation = useMutation({
    mutationFn: updateAccessGrant,
    onSuccess: () => invalidateAccessQueries(queryClient),
  })
  const updateGrant = updateGrantMutation.mutateAsync
  const removeGrantMutation = useMutation({
    mutationFn: removeAccessGrant,
    onSuccess: async () => {
      setRemoveTarget(null)
      showToast({ message: "Access removed", type: "success" })
      await invalidateAccessQueries(queryClient)
    },
    onError: (cause) =>
      showToast({
        message: errorMessage(cause, "Could not remove access"),
        type: "error",
      }),
  })
  const revokeInvitationMutation = useMutation({
    mutationFn: revokeAccessInvitation,
    onSuccess: async () => {
      showToast({ message: "Invitation revoked", type: "success" })
      await invalidateAccessQueries(queryClient)
    },
    onError: (cause) =>
      showToast({
        message: errorMessage(cause, "Could not revoke invitation"),
        type: "error",
      }),
  })

  const changeRole = React.useCallback(
    async (grant: AccessGrant, role: AccessRole) => {
      await Effect.runPromise(
        Effect.tryPromise({
          try: () =>
            updateGrant({
              data: { id: grant.id, relayId: grant.relayId, role },
            }),
          catch: (cause) => cause,
        }).pipe(
          Effect.catch((cause) =>
            Effect.sync(() =>
              showToast({
                message: errorMessage(cause, "Could not update access"),
                type: "error",
              })
            )
          )
        )
      )
    },
    [updateGrant]
  )
  const selectRemoveTarget = React.useCallback((row: AccessDirectoryRow) => {
    if (!row.grant) return
    setRemoveTarget({
      email: row.email,
      grantId: row.grant.id,
      relayId: row.relayId,
      resourceName: row.resourceName,
    })
  }, [])
  const changeRowRole = React.useCallback(
    (row: AccessDirectoryRow, role: AccessRole) => {
      if (row.grant) void changeRole(row.grant, role)
    },
    [changeRole]
  )

  return (
    <div className="mx-auto w-full max-w-[90rem] px-3 pt-4 pb-10 sm:px-5">
      <section
        data-slot="access-workspace"
        className="overflow-hidden rounded-xl border bg-card/45 [contain:paint]"
      >
        <AccessToolbar
          activeFilterCount={activeFilterCount}
          filters={filters}
          invitationCount={overview.invitations.length}
          relays={overview.relays}
          searchStore={searchStore}
          onAdd={openAddDialog}
          onFiltersChange={updateFilters}
          onPending={openPendingDialog}
        />
        <AccessDirectoryTable
          filtersActive={activeFilterCount > 0}
          ownerRelayIds={ownerRelayIds}
          pendingGrantId={
            updateGrantMutation.isPending
              ? updateGrantMutation.variables?.data.id
              : undefined
          }
          rows={filteredRows}
          searchStore={searchStore}
          onRemove={selectRemoveTarget}
          onRoleChange={changeRowRole}
        />
      </section>

      {pendingOpen ? (
        <PendingInvitationsDialog
          open
          databases={databases}
          invitations={overview.invitations}
          instances={instances}
          ownerRelayIds={ownerRelayIds}
          pendingId={
            revokeInvitationMutation.isPending
              ? revokeInvitationMutation.variables?.data.id
              : undefined
          }
          onOpenChange={setPendingOpen}
          onRevoke={(id, relayId) => {
            revokeInvitationMutation.mutate({ data: { id, relayId } })
          }}
        />
      ) : null}

      {addOpen ? (
        <AddUserDialog
          open
          ownerRelayIds={ownerRelayIds}
          targets={targets}
          onComplete={(result) => {
            setAddOpen(false)
            showAccessAssignmentToast(result)
            void invalidateAccessQueries(queryClient)
          }}
          onOpenChange={setAddOpen}
        />
      ) : null}

      <RemoveAccessDialog
        pending={removeGrantMutation.isPending}
        target={removeTarget}
        onConfirm={(target) =>
          removeGrantMutation.mutate({
            data: { id: target.grantId, relayId: target.relayId },
          })
        }
        onOpenChange={(open) => {
          if (!open && !removeGrantMutation.isPending) {
            setRemoveTarget(null)
            removeGrantMutation.reset()
          }
        }}
      />
    </div>
  )
}

const AccessToolbar = React.memo(function AccessToolbar({
  activeFilterCount,
  filters,
  invitationCount,
  relays,
  searchStore,
  onAdd,
  onFiltersChange,
  onPending,
}: {
  activeFilterCount: number
  filters: AccessFilters
  invitationCount: number
  relays: AccessOverview["relays"]
  searchStore: WorkspaceTableSearchStore
  onAdd: () => void
  onFiltersChange: (change: Partial<AccessFilters>) => void
  onPending: () => void
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  useWorkspaceTableSearchInput(inputRef, searchStore)

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 border-b bg-background/25 p-3">
      <AccessSyncButton />

      <div className="relative min-w-48 flex-1 sm:max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          aria-label="Search user access"
          className="pl-9 text-base md:text-sm"
          defaultValue={searchStore.getServerSnapshot()}
          placeholder="Search emails or scopes"
          type="search"
          onChange={(event) => searchStore.set(event.currentTarget.value)}
        />
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <AccessFilterSelect
          ariaLabel="Filter access by role"
          icon={<UserRound />}
          value={filters.role}
          onChange={(role) =>
            onFiltersChange({ role: accessRoleFilterFromValue(role) })
          }
        >
          <option value="">All roles</option>
          {accessRoles.map((role) => (
            <option key={role} value={role}>
              {accessRoleDetails[role].label}
            </option>
          ))}
        </AccessFilterSelect>

        <AccessFilterSelect
          ariaLabel="Filter access by scope"
          icon={<ListFilter />}
          value={filters.resourceType}
          onChange={(resourceType) =>
            onFiltersChange({
              resourceType: accessResourceFilterFromValue(resourceType),
            })
          }
        >
          <option value="">All scopes</option>
          <option value="relay">Relays</option>
          <option value="instance">Servers</option>
          <option value="database">Databases</option>
        </AccessFilterSelect>

        {relays.length > 1 ? (
          <AccessFilterSelect
            ariaLabel="Filter access by Relay"
            icon={<Network />}
            value={filters.relayId}
            onChange={(relayId) => onFiltersChange({ relayId })}
          >
            <option value="">All Relays</option>
            {relays.map((relay) => (
              <option key={relay.id} value={relay.id}>
                {relay.name}
              </option>
            ))}
          </AccessFilterSelect>
        ) : null}

        {activeFilterCount > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onFiltersChange(emptyAccessFilters)}
          >
            <X />
            Clear {activeFilterCount}
          </Button>
        ) : null}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              aria-label={`Pending invitations, ${invitationCount}`}
              onClick={onPending}
            >
              <Clock3 />
              <span className="hidden sm:inline">Pending</span>
              <Badge
                variant="outline"
                className="h-4 min-w-4 justify-center border-border/80 px-1 font-mono text-[8px]"
              >
                {invitationCount}
              </Badge>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Pending invitations</TooltipContent>
        </Tooltip>
        <Button type="button" className="shrink-0" onClick={onAdd}>
          <Plus />
          <span className="hidden sm:inline">Add user</span>
          <span className="sm:hidden">Add</span>
        </Button>
      </div>
    </div>
  )
})

const AccessSyncButton = React.memo(function AccessSyncButton() {
  const queryClient = useQueryClient()
  const syncMutation = useMutation({
    mutationFn: () =>
      queryClient.refetchQueries(
        { exact: true, queryKey: queryKeys.access.overview },
        { throwOnError: true }
      ),
    onError: (cause) =>
      showToast({
        message: errorMessage(cause, "Could not sync access"),
        type: "error",
      }),
  })
  const syncing = syncMutation.isPending

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="Sync access"
          aria-busy={syncing}
          disabled={syncing}
          onClick={() => syncMutation.mutate()}
        >
          <RefreshCw className={syncing ? "animate-spin" : ""} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        Sync access
      </TooltipContent>
    </Tooltip>
  )
})

function AccessFilterSelect({
  ariaLabel,
  children,
  icon,
  onChange,
  value,
}: {
  ariaLabel: string
  children: React.ReactNode
  icon: React.ReactNode
  onChange: (value: string) => void
  value: string
}) {
  return (
    <label
      className={`relative inline-flex h-8 min-w-0 items-center border bg-input/20 text-xs text-foreground/90 transition-colors hover:border-primary/35 hover:bg-accent/70 ${
        value ? "border-primary/35 bg-primary/7" : "border-input/90"
      }`}
    >
      <span className="pointer-events-none ml-2 text-muted-foreground [&_svg]:size-3.5">
        {icon}
      </span>
      <select
        aria-label={ariaLabel}
        className="h-full min-w-0 appearance-none bg-transparent py-0 pr-7 pl-1.5 outline-none"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 size-3 text-muted-foreground" />
    </label>
  )
}

const AccessDirectoryTable = React.memo(function AccessDirectoryTable({
  filtersActive,
  ownerRelayIds,
  pendingGrantId,
  rows,
  searchStore,
  onRemove,
  onRoleChange,
}: {
  filtersActive: boolean
  ownerRelayIds: ReadonlySet<string>
  pendingGrantId?: string
  rows: Array<AccessDirectoryRow>
  searchStore: WorkspaceTableSearchStore
  onRemove: (row: AccessDirectoryRow) => void
  onRoleChange: (row: AccessDirectoryRow, role: AccessRole) => void
}) {
  const renderRow = React.useCallback(
    (row: AccessDirectoryRow) => (
      <AccessDirectoryTableRow
        ownerRelayIds={ownerRelayIds}
        pending={row.grant?.id === pendingGrantId}
        row={row}
        onRemove={onRemove}
        onRoleChange={onRoleChange}
      />
    ),
    [onRemove, onRoleChange, ownerRelayIds, pendingGrantId]
  )
  const renderEmpty = React.useCallback(
    (searchActive: boolean) => (
      <div className="grid min-h-52 place-items-center px-5 text-center">
        <div>
          <Users className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold">
            {searchActive || filtersActive
              ? "No matching access"
              : "No scoped users yet"}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {searchActive || filtersActive
              ? "Try another email, scope, Relay, or role."
              : "Add a user to grant access to a Relay, server, or database."}
          </p>
        </div>
      </div>
    ),
    [filtersActive]
  )

  return (
    <WorkspaceDataTable
      getRowKey={accessDirectoryRowKey}
      getSearchText={accessDirectorySearchText}
      head={<AccessDirectoryTableHead />}
      items={rows}
      renderEmpty={renderEmpty}
      renderRow={renderRow}
      searchStore={searchStore}
    />
  )
})

const AccessDirectoryTableHead = React.memo(
  function AccessDirectoryTableHead() {
    return (
      <WorkspaceTableHead>
        <WorkspaceTableHeading className="w-auto sm:w-[27%]">
          User
        </WorkspaceTableHeading>
        <WorkspaceTableHeading className="w-[34%] sm:w-[28%]">
          Scope
        </WorkspaceTableHeading>
        <WorkspaceTableHeading className="hidden w-[18%] lg:table-cell">
          Relay
        </WorkspaceTableHeading>
        <WorkspaceTableHeading className="w-28 sm:w-32">
          Role
        </WorkspaceTableHeading>
        <WorkspaceTableHeading className="hidden w-24 xl:table-cell">
          Added
        </WorkspaceTableHeading>
        <WorkspaceTableHeading className="w-20 px-1 text-right sm:w-24 sm:px-3">
          Actions
        </WorkspaceTableHeading>
      </WorkspaceTableHead>
    )
  }
)

const AccessDirectoryTableRow = React.memo(function AccessDirectoryTableRow({
  ownerRelayIds,
  pending,
  row,
  onRemove,
  onRoleChange,
}: {
  ownerRelayIds: ReadonlySet<string>
  pending: boolean
  row: AccessDirectoryRow
  onRemove: (row: AccessDirectoryRow) => void
  onRoleChange: (row: AccessDirectoryRow, role: AccessRole) => void
}) {
  const ownerActionAllowed =
    row.role !== "owner" || ownerRelayIds.has(row.relayId)
  const canRepairOwnerRole =
    row.instanceOwner &&
    row.grant !== null &&
    row.role !== "owner" &&
    ownerRelayIds.has(row.relayId)
  const roles: ReadonlyArray<AccessRole> = row.instanceOwner
    ? canRepairOwnerRole
      ? [row.role, "owner"]
      : [row.role]
    : rolesForRelay(ownerRelayIds, row.relayId, row.role)
  const roleChangeAllowed =
    row.grant !== null &&
    ownerActionAllowed &&
    (!row.instanceOwner || canRepairOwnerRole)
  const removeAllowed =
    row.grant !== null &&
    ownerActionAllowed &&
    !row.grant.protectedInstanceOwnerGrant
  const roleSelect = (
    <select
      aria-label={`Role for ${row.email} on ${row.resourceName}`}
      className="h-8 w-full rounded-md border border-input bg-background px-2 text-[10px] outline-none focus:border-ring disabled:cursor-not-allowed disabled:opacity-65"
      disabled={pending || !roleChangeAllowed}
      value={row.role}
      onChange={(event) =>
        onRoleChange(row, accessRoleFromValue(event.currentTarget.value))
      }
    >
      {roles.map((role) => (
        <option key={role} value={role}>
          {accessRoleDetails[role].label}
        </option>
      ))}
    </select>
  )

  return (
    <tr className="group transition-colors hover:bg-accent/25">
      <WorkspaceTableCell>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border/70 bg-background/35 text-muted-foreground">
            <UserRound className="size-3.5" />
          </span>
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-xs font-medium">{row.email}</p>
            {row.platformAdministrator ? (
              <Badge
                variant="outline"
                className="hidden border-primary/30 bg-primary/8 font-mono text-[7px] text-primary sm:inline-flex"
              >
                Platform admin
              </Badge>
            ) : null}
          </div>
        </div>
      </WorkspaceTableCell>
      <WorkspaceTableCell>
        <div className="flex min-w-0 items-center gap-2">
          <ScopeIcon resourceType={row.resourceType} />
          <div className="min-w-0">
            <p className="truncate text-[10px] font-medium text-foreground">
              {row.resourceName}
            </p>
            <p className="truncate font-mono text-[8px] text-muted-foreground uppercase">
              {row.resourceType === "instance" ? "Server" : row.resourceType}
              {row.instanceOwner ? " · owner" : ""}
            </p>
          </div>
        </div>
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden lg:table-cell">
        <p className="truncate text-[10px] text-foreground">{row.relayName}</p>
        <p className="truncate font-mono text-[8px] text-muted-foreground">
          {row.relayId}
        </p>
      </WorkspaceTableCell>
      <WorkspaceTableCell>
        {row.instanceOwner && !canRepairOwnerRole ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                aria-label="Why this role cannot be changed"
                className="block w-full"
                tabIndex={0}
              >
                {roleSelect}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Transfer ownership before changing this role
            </TooltipContent>
          </Tooltip>
        ) : (
          roleSelect
        )}
      </WorkspaceTableCell>
      <WorkspaceTableCell className="hidden font-mono text-[9px] text-muted-foreground xl:table-cell">
        <HydratedDate value={row.createdAt} />
      </WorkspaceTableCell>
      <WorkspaceTableCell className="px-1 sm:px-3">
        <div className="flex items-center justify-end gap-0.5">
          {row.instanceId ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild size="icon-sm" variant="ghost">
                  <Link
                    aria-label={`View ${row.email} activity`}
                    search={{ server: row.instanceId, user: row.userId }}
                    to="/activity"
                  >
                    <Activity />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">View activity</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${row.email} from ${row.resourceName}`}
                  disabled={pending || !removeAllowed}
                  onClick={() => onRemove(row)}
                >
                  {pending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Trash2 />
                  )}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {row.instanceOwner
                ? "Transfer ownership before removing"
                : row.grant
                  ? "Remove this access only"
                  : "Owner access is managed by transfer"}
            </TooltipContent>
          </Tooltip>
        </div>
      </WorkspaceTableCell>
    </tr>
  )
})

function AddUserDialog({
  open,
  ownerRelayIds,
  targets,
  onComplete,
  onOpenChange,
}: {
  open: boolean
  ownerRelayIds: ReadonlySet<string>
  targets: Array<AccessTarget>
  onComplete: (result: Awaited<ReturnType<typeof grantOrInviteAccess>>) => void
  onOpenChange: (open: boolean) => void
}) {
  const [email, setEmail] = React.useState("")
  const [targetKey, setTargetKey] = React.useState(() =>
    targets[0] ? serverPickerOptionKey(targets[0]) : ""
  )
  const [role, setRole] = React.useState<AccessRole>("operator")
  const [scopeOpen, setScopeOpen] = React.useState(false)
  const mutation = useMutation({
    mutationFn: grantOrInviteAccess,
    onError: (cause) =>
      showToast({
        message: errorMessage(cause, "Could not add user access"),
        type: "error",
      }),
    onSuccess: onComplete,
  })
  const selectedTarget = targets.find(
    (target) => serverPickerOptionKey(target) === targetKey
  )
  const selectedKeys = React.useMemo(
    () => new Set(targetKey ? [targetKey] : []),
    [targetKey]
  )
  const assignableRoles = selectedTarget
    ? rolesForRelay(ownerRelayIds, selectedTarget.relayId)
    : accessRoles.filter((accessRole) => accessRole !== "owner")

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedTarget || mutation.isPending) return
    await Effect.runPromise(
      Effect.tryPromise({
        try: () =>
          mutation.mutateAsync({
            data: {
              databaseId: selectedTarget.databaseId,
              email,
              instanceId: selectedTarget.instanceId,
              relayId: selectedTarget.relayId,
              resourceName: selectedTarget.resourceName,
              role,
            },
          }),
        catch: (cause) => cause,
      }).pipe(Effect.catch(() => Effect.void))
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!mutation.isPending) onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        className="overflow-visible sm:max-w-xl"
        showCloseButton={!mutation.isPending}
      >
        <DialogHeader>
          <DialogTitle>Add user access</DialogTitle>
          <DialogDescription>
            Existing accounts receive access immediately. New emails receive a
            seven-day invitation. When email delivery is configured, both paths
            send an email.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <Field label="Email address">
            <Input
              autoFocus
              required
              type="email"
              autoComplete="email"
              placeholder="operator@example.com"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </Field>

          <Field label="Access scope">
            <Popover open={scopeOpen} onOpenChange={setScopeOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-10 w-full justify-between px-3 py-2 text-left"
                >
                  {selectedTarget ? (
                    <span className="flex min-w-0 items-center gap-2.5">
                      <ScopeIcon
                        resourceType={
                          selectedTarget.kind === "server"
                            ? "instance"
                            : (selectedTarget.kind ?? "relay")
                        }
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold">
                          {selectedTarget.name}
                        </span>
                        <span className="block truncate font-mono text-[8px] text-muted-foreground">
                          {selectedTarget.description}
                        </span>
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Choose scope</span>
                  )}
                  <ChevronDown className="ml-3 size-4 shrink-0 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="z-[70] w-[min(34rem,calc(100vw-3rem))] p-1.5"
              >
                <ServerPickerList
                  ariaLabel="Access scopes"
                  emptyMessage="No matching Relays, servers, or databases."
                  multiple={false}
                  searchPlaceholder="Search by server, Relay, database, or ID"
                  selectedKeys={selectedKeys}
                  servers={targets}
                  onSelect={(option) => {
                    const nextKey = serverPickerOptionKey(option)
                    const nextTarget = targets.find(
                      (target) => serverPickerOptionKey(target) === nextKey
                    )
                    setTargetKey(nextKey)
                    if (
                      role === "owner" &&
                      nextTarget &&
                      !ownerRelayIds.has(nextTarget.relayId)
                    ) {
                      setRole("operator")
                    }
                    setScopeOpen(false)
                  }}
                />
              </PopoverContent>
            </Popover>
          </Field>

          <Field label="Role">
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-ring"
              value={role}
              onChange={(event) =>
                setRole(accessRoleFromValue(event.currentTarget.value))
              }
            >
              {assignableRoles.map((accessRole) => (
                <option key={accessRole} value={accessRole}>
                  {accessRoleDetails[accessRole].label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
              {accessRoleDetails[role].description}
            </p>
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!selectedTarget || mutation.isPending}
            >
              {mutation.isPending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Plus />
              )}
              Add user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RemoveAccessDialog({
  pending,
  target,
  onConfirm,
  onOpenChange,
}: {
  pending: boolean
  target: RemoveTarget | null
  onConfirm: (target: RemoveTarget) => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Remove this access?</DialogTitle>
          <DialogDescription>
            {target?.email ?? "This user"} will lose access to{" "}
            {target?.resourceName ?? "this scope"}. Their Kiln account and all
            other server or Relay access will remain intact.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!target || pending}
            onClick={() => {
              if (!target) return
              onConfirm(target)
            }}
          >
            {pending ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
            Remove access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PendingInvitationsDialog({
  databases,
  invitations,
  instances,
  open,
  ownerRelayIds,
  pendingId,
  onOpenChange,
  onRevoke,
}: {
  databases: ManagedDatabaseDirectory
  invitations: AccessOverview["invitations"]
  instances: Array<FleetRelayInstance>
  open: boolean
  ownerRelayIds: ReadonlySet<string>
  pendingId?: string
  onOpenChange: (open: boolean) => void
  onRevoke: (id: string, relayId: string) => void
}) {
  const titleRef = React.useRef<HTMLHeadingElement>(null)
  const instanceNames = React.useMemo(
    () =>
      new Map(
        instances.map((instance) => [
          accessResourceKey(instance.relayId, instance.id),
          instance.name,
        ])
      ),
    [instances]
  )
  const databaseNames = React.useMemo(
    () =>
      new Map(
        databases.map((database) => [
          accessResourceKey(database.relayId, database.id),
          database.name,
        ])
      ),
    [databases]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        initialFocus={titleRef}
        className="max-h-[calc(100vh-2rem)] overflow-hidden sm:max-w-4xl"
      >
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1}>
            Pending invitations
          </DialogTitle>
          <DialogDescription>
            Invitations expire after seven days. Accounts are created only after
            the recipient accepts.
          </DialogDescription>
        </DialogHeader>

        {invitations.length > 0 ? (
          <div className="max-h-[min(32rem,60vh)] overflow-auto rounded-lg border">
            <table className="w-full min-w-[40rem] table-fixed border-collapse text-left">
              <WorkspaceTableHead>
                <WorkspaceTableHeading className="w-[31%]">
                  Email
                </WorkspaceTableHeading>
                <WorkspaceTableHeading className="w-[31%]">
                  Scope
                </WorkspaceTableHeading>
                <WorkspaceTableHeading className="w-28">
                  Role
                </WorkspaceTableHeading>
                <WorkspaceTableHeading className="w-28">
                  Expires
                </WorkspaceTableHeading>
                <WorkspaceTableHeading className="w-20 text-right">
                  Actions
                </WorkspaceTableHeading>
              </WorkspaceTableHead>
              <tbody className="divide-y divide-border/70">
                {invitations.map((invitation) => {
                  const instanceName = invitation.instanceId
                    ? instanceNames.get(
                        accessResourceKey(
                          invitation.relayId,
                          invitation.instanceId
                        )
                      )
                    : undefined
                  const databaseName = invitation.databaseId
                    ? databaseNames.get(
                        accessResourceKey(
                          invitation.relayId,
                          invitation.databaseId
                        )
                      )
                    : undefined
                  const resourceName =
                    databaseName ?? instanceName ?? invitation.relayName
                  return (
                    <tr key={invitation.id} className="hover:bg-accent/25">
                      <WorkspaceTableCell>
                        <p className="truncate text-xs font-medium">
                          {invitation.email}
                        </p>
                      </WorkspaceTableCell>
                      <WorkspaceTableCell>
                        <p className="truncate text-[10px]">{resourceName}</p>
                        <p className="font-mono text-[8px] text-muted-foreground uppercase">
                          {databaseName
                            ? "Database"
                            : instanceName
                              ? "Server"
                              : "Relay"}
                        </p>
                      </WorkspaceTableCell>
                      <WorkspaceTableCell>
                        <Badge
                          variant="outline"
                          className="font-mono text-[8px] capitalize"
                        >
                          {invitation.role}
                        </Badge>
                      </WorkspaceTableCell>
                      <WorkspaceTableCell className="font-mono text-[9px] text-muted-foreground">
                        <HydratedDate value={invitation.expiresAt} />
                      </WorkspaceTableCell>
                      <WorkspaceTableCell>
                        <div className="flex justify-end">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={`Revoke invitation for ${invitation.email}`}
                                  disabled={
                                    pendingId !== undefined ||
                                    (invitation.role === "owner" &&
                                      !ownerRelayIds.has(invitation.relayId))
                                  }
                                  onClick={() =>
                                    onRevoke(invitation.id, invitation.relayId)
                                  }
                                >
                                  {pendingId === invitation.id ? (
                                    <LoaderCircle className="animate-spin" />
                                  ) : (
                                    <Trash2 />
                                  )}
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              {invitation.role === "owner" &&
                              !ownerRelayIds.has(invitation.relayId)
                                ? "Only a Relay owner can revoke this invitation"
                                : "Revoke invitation"}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </WorkspaceTableCell>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid min-h-48 place-items-center rounded-lg border border-dashed bg-muted/10 px-5 text-center">
            <div>
              <Clock3 className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 text-sm font-semibold">
                No pending invitations
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                New invitations will appear here until they are accepted or
                revoked.
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ScopeIcon({
  resourceType,
}: {
  resourceType: "database" | "instance" | "relay"
}) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border/70 bg-background/35 text-muted-foreground">
      {resourceType === "relay" ? (
        <Network className="size-3.5" />
      ) : resourceType === "database" ? (
        <Database className="size-3.5" />
      ) : (
        <Server className="size-3.5" />
      )}
    </span>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block text-[10px] font-medium text-muted-foreground">
      <span className="mb-1.5 block">{label}</span>
      {children}
    </label>
  )
}

function HydratedDate({ value }: { value: string }) {
  return React.useSyncExternalStore(
    subscribeToBrowserLocale,
    () => invitationExpiryFormatter.format(new Date(value)),
    () => "—"
  )
}

function accessTargets(
  overview: AccessOverview,
  instances: Array<FleetRelayInstance>,
  databases: ManagedDatabaseDirectory
): Array<AccessTarget> {
  const instancesByRelay = new Map<string, Array<FleetRelayInstance>>()
  for (const instance of instances) {
    const relayInstances = instancesByRelay.get(instance.relayId) ?? []
    relayInstances.push(instance)
    instancesByRelay.set(instance.relayId, relayInstances)
  }
  const databasesByRelay = new Map<
    string,
    Array<ManagedDatabaseDirectory[number]>
  >()
  for (const database of databases) {
    const relayDatabases = databasesByRelay.get(database.relayId) ?? []
    relayDatabases.push(database)
    databasesByRelay.set(database.relayId, relayDatabases)
  }

  return overview.relays.flatMap((relay) => [
    {
      databaseId: null,
      description: "Every server and database on this Relay",
      id: relay.id,
      instanceId: null,
      kind: "relay",
      name: relay.name,
      relayId: relay.id,
      relayName: relay.name,
      resourceName: relay.name,
    },
    ...(instancesByRelay.get(relay.id) ?? []).map(
      (instance) =>
        ({
          databaseId: null,
          description: `${relay.name} · ${instance.id}`,
          id: instance.id,
          instanceId: instance.id,
          kind: "server",
          name: instance.name,
          relayId: relay.id,
          relayName: relay.name,
          resourceName: instance.name,
        }) satisfies AccessTarget
    ),
    ...(databasesByRelay.get(relay.id) ?? []).map(
      (database) =>
        ({
          databaseId: database.id,
          description: `${relay.name} · ${database.id}`,
          id: database.id,
          instanceId: null,
          kind: "database",
          name: database.name,
          relayId: relay.id,
          relayName: relay.name,
          resourceName: database.name,
        }) satisfies AccessTarget
    ),
  ])
}

function accessDirectoryRows(
  overview: AccessOverview,
  instances: Array<FleetRelayInstance>,
  databases: ManagedDatabaseDirectory
): Array<AccessDirectoryRow> {
  const instanceNames = new Map(
    instances.map((instance) => [
      accessResourceKey(instance.relayId, instance.id),
      instance.name,
    ])
  )
  const databaseNames = new Map(
    databases.map((database) => [
      accessResourceKey(database.relayId, database.id),
      database.name,
    ])
  )
  const directOwnerKeys = new Set(
    overview.grants.flatMap((grant) =>
      grant.resourceType === "instance"
        ? [`${grant.relayId}:${grant.resourceId}:${grant.userId}`]
        : []
    )
  )
  const grantRows = overview.grants.map((grant) =>
    accessGrantDirectoryRow(grant, instanceNames, databaseNames)
  )
  const ownerRows = overview.owners.flatMap((owner) =>
    directOwnerKeys.has(`${owner.relayId}:${owner.instanceId}:${owner.userId}`)
      ? []
      : [accessOwnerDirectoryRow(owner, instanceNames)]
  )
  return [...grantRows, ...ownerRows].sort((left, right) =>
    `${left.email}\u0000${left.resourceName}`.localeCompare(
      `${right.email}\u0000${right.resourceName}`
    )
  )
}

function accessGrantDirectoryRow(
  grant: AccessGrant,
  instanceNames: ReadonlyMap<string, string>,
  databaseNames: ReadonlyMap<string, string>
): AccessDirectoryRow {
  const resourceKey = accessResourceKey(grant.relayId, grant.resourceId)
  return {
    createdAt: grant.createdAt,
    email: grant.email,
    grant,
    instanceId: grant.resourceType === "instance" ? grant.resourceId : null,
    instanceOwner: grant.instanceOwner,
    key: `grant:${grant.id}`,
    platformAdministrator: grant.platformAdministrator,
    relayId: grant.relayId,
    relayName: grant.relayName,
    resourceId: grant.resourceId,
    resourceName:
      grant.resourceType === "relay"
        ? grant.relayName
        : (databaseNames.get(resourceKey) ??
          instanceNames.get(resourceKey) ??
          grant.resourceId),
    resourceType: grant.resourceType,
    role: grant.role,
    userId: grant.userId,
  }
}

function accessOwnerDirectoryRow(
  owner: AccessOwner,
  instanceNames: ReadonlyMap<string, string>
): AccessDirectoryRow {
  return {
    createdAt: owner.createdAt,
    email: owner.email,
    grant: null,
    instanceId: owner.instanceId,
    instanceOwner: true,
    key: `owner:${owner.relayId}:${owner.instanceId}:${owner.userId}`,
    platformAdministrator: owner.platformAdministrator,
    relayId: owner.relayId,
    relayName: owner.relayName,
    resourceId: owner.instanceId,
    resourceName:
      instanceNames.get(accessResourceKey(owner.relayId, owner.instanceId)) ??
      owner.instanceId,
    resourceType: "instance",
    role: "owner",
    userId: owner.userId,
  }
}

function accessResourceKey(relayId: string, resourceId: string): string {
  return `${relayId}:${resourceId}`
}

function accessDirectoryRowKey(row: AccessDirectoryRow): string {
  return row.key
}

function accessDirectorySearchText(row: AccessDirectoryRow): string {
  return `${row.email} ${row.resourceName} ${row.resourceId} ${row.resourceType} ${row.relayName} ${row.relayId} ${row.role}`
}

function showAccessAssignmentToast(
  result: Awaited<ReturnType<typeof grantOrInviteAccess>>
): void {
  if (result.kind === "granted") {
    const notificationDescription = {
      disabled: "Email delivery is disabled; no notification was sent.",
      failed: "Access was granted, but the notification email could not be sent.",
      sent: "A notification email was sent.",
    } satisfies Record<typeof result.notificationStatus, string>
    showToast({
      description: notificationDescription[result.notificationStatus],
      message: `${result.email} now has access`,
      type: "success",
    })
    return
  }

  if (!result.inviteUrl) {
    showToast({ message: "Invitation sent", type: "success" })
    return
  }

  const invitationUrl = result.inviteUrl
  showToast({
    action: {
      label: "Copy link",
      onClick: () => {
        void Effect.runPromise(
          Effect.tryPromise({
            try: () => navigator.clipboard.writeText(invitationUrl),
            catch: (cause) => cause,
          }).pipe(
            Effect.match({
              onFailure: () =>
                showToast({
                  message: "Could not copy the invitation link",
                  type: "error",
                }),
              onSuccess: () =>
                showToast({
                  message: "Invitation link copied",
                  type: "success",
                }),
            })
          )
        )
      },
    },
    description: "Email delivery is disabled locally.",
    duration: Infinity,
    message: "Invitation created",
    type: "success",
  })
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

function accessRoleFromValue(value: string): AccessRole {
  return isAccessRole(value) ? value : "viewer"
}

function accessRoleFilterFromValue(value: string): AccessFilters["role"] {
  return isAccessRole(value) ? value : ""
}

function accessResourceFilterFromValue(
  value: string
): AccessFilters["resourceType"] {
  return value === "database" || value === "instance" || value === "relay"
    ? value
    : ""
}

function rolesForRelay(
  ownerRelayIds: ReadonlySet<string>,
  relayId: string,
  currentRole?: AccessRole
): ReadonlyArray<AccessRole> {
  return ownerRelayIds.has(relayId) || currentRole === "owner"
    ? accessRoles
    : accessRoles.filter((role) => role !== "owner")
}

function subscribeToBrowserLocale(): () => void {
  return () => undefined
}

function invalidateAccessQueries(
  queryClient: ReturnType<typeof useQueryClient>
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.access.overview }),
    queryClient.invalidateQueries({ queryKey: queryKeys.access.capabilities }),
    queryClient.invalidateQueries({ queryKey: ["access", "instances"] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.databases.directory }),
  ])
}
