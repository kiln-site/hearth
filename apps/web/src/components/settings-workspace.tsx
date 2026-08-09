import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Effect } from "effect"
import {
  Activity,
  ArrowRight,
  Box,
  Check,
  Copy,
  Cpu,
  Fingerprint,
  Globe2,
  HardDrive,
  LoaderCircle,
  Network,
  Pencil,
  Save,
  Server,
  Tags,
  Trash2,
  TriangleAlert,
  UserRound,
  Users,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import { ServerDeleteDialog } from "@/components/server-delete-dialog"
import { hostPortAddress } from "@/lib/domain-address"
import {
  instanceUsersQueryOptions,
  queryKeys,
  replaceRelaySnapshotInstance,
} from "@/lib/query-options"
import type { RelayFleetSnapshot } from "@/lib/relay-fleet"
import type {
  InstanceSettingsInstance,
  RelayNodeSummary,
} from "@/lib/relay-selectors"
import { removeInstanceAccessGrant } from "@/server/access"
import type { getInstanceUsers } from "@/server/access"
import { updateInstanceName } from "@/server/relay"

type InstanceUsers = Awaited<ReturnType<typeof getInstanceUsers>>

export function SettingsWorkspace({
  instance,
  node,
  canDelete,
  canRename,
  onDeleted,
  relayConnected,
}: {
  instance: InstanceSettingsInstance
  node: RelayNodeSummary
  canDelete: boolean
  canRename: boolean
  onDeleted: () => Promise<void> | void
  relayConnected: boolean
}) {
  const rawAddress =
    instance.publicHost && instance.publicPort
      ? hostPortAddress(instance.publicHost, instance.publicPort)
      : instance.connectAddress
  const configuredAddress =
    instance.connectAddress !== rawAddress ? instance.connectAddress : null

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-card">
      <div className="mx-auto max-w-5xl px-5 py-6 sm:px-8 sm:py-8">
        <div className="flex justify-end">
          <Button asChild size="sm" variant="outline">
            <Link to="/activity" search={{ server: instance.id }}>
              <Activity />
              Activity
            </Link>
          </Button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <InfoCard>
            <InfoCardHeader
              icon={<Fingerprint />}
              title="Identity"
              action={
                <Badge variant="outline" className="font-mono text-[9px]">
                  {instance.game}
                </Badge>
              }
            />
            <InstanceNameForm
              instance={instance}
              canRename={canRename && relayConnected}
            />
            <MetaRow
              icon={Fingerprint}
              label="Server full ID"
              value={instance.id}
              mono
              wrap
            />
          </InfoCard>

          <InfoCard>
            <InfoCardHeader
              icon={<Globe2 />}
              title="Connection info"
              action={
                <Button asChild size="sm" variant="ghost">
                  <Link
                    to="/server/$serverId/network"
                    params={{ serverId: instance.routeId }}
                  >
                    Network
                    <ArrowRight />
                  </Link>
                </Button>
              }
            />
            <CopyMetaRow label="Raw connection URL" value={rawAddress} />
            <CopyMetaRow
              label="Configured URL"
              value={configuredAddress ?? "Not configured"}
              copyable={configuredAddress !== null}
            />
          </InfoCard>

          <InfoCard>
            <InfoCardHeader
              icon={<Box />}
              title="Brick info"
              action={
                <Button asChild size="sm" variant="ghost">
                  <Link
                    to="/server/$serverId/startup"
                    params={{ serverId: instance.routeId }}
                  >
                    Startup
                    <ArrowRight />
                  </Link>
                </Button>
              }
            />
            <MetaRow
              icon={Box}
              label="Brick"
              value={instance.brickId ?? instance.implementation}
              mono
            />
            <MetaRow
              icon={Tags}
              label="Game version"
              value={`${instance.game} · ${instance.version}`}
            />
            <MetaRow
              icon={Cpu}
              label="Runtime"
              value={instance.javaVersion}
              mono
            />
            <MetaRow
              icon={HardDrive}
              label="Recipe"
              value={instance.brickSource ?? instance.brickFormat ?? "Built in"}
              mono
            />
          </InfoCard>

          <InfoCard>
            <InfoCardHeader
              icon={<Network />}
              title="Relay placement"
              action={
                <span
                  className={`flex items-center gap-1.5 font-mono text-[9px] ${relayConnected ? "text-emerald-400" : "text-amber-300"}`}
                >
                  <span
                    className={`size-1.5 rounded-full ${relayConnected ? "bg-emerald-400" : "bg-amber-300"}`}
                  />
                  {relayConnected ? "CONNECTED" : "LAST KNOWN"}
                </span>
              }
            />
            <MetaRow
              icon={HardDrive}
              label="Node"
              value={`${node.name} · ${node.id}`}
            />
            <MetaRow
              icon={Box}
              label="Container"
              value={instance.containerId ?? "Not created"}
              mono
            />
            <MetaRow
              icon={Tags}
              label="Compose service"
              value={instance.service}
              mono
            />
            <MetaRow
              icon={HardDrive}
              label="Data directory"
              value={instance.directory}
              mono
            />
          </InfoCard>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <InstanceUsersCard instance={instance} />
        </div>

        {canDelete ? (
          <ServerDangerZone
            instance={instance}
            onDeleted={onDeleted}
            relayConnected={relayConnected}
          />
        ) : null}
      </div>
    </section>
  )
}

function InfoCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-background/45">
      {children}
    </div>
  )
}

function InfoCardHeader({
  action,
  icon,
  title,
}: {
  action?: React.ReactNode
  icon: React.ReactNode
  title: string
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-b px-4 py-2.5">
      <div className="flex items-center gap-2 text-primary [&_svg]:size-4">
        {icon}
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {action}
    </div>
  )
}

function CopyMetaRow({
  copyable = true,
  label,
  value,
}: {
  copyable?: boolean
  label: string
  value: string
}) {
  const [copied, setCopied] = React.useState(false)
  const resetTimer = React.useRef<number | null>(null)

  React.useEffect(
    () => () => {
      if (resetTimer.current) window.clearTimeout(resetTimer.current)
    },
    []
  )

  async function copyValue() {
    if (!copyable) return
    await navigator.clipboard.writeText(value)
    setCopied(true)
    if (resetTimer.current) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="flex min-h-16 items-center gap-3 border-b px-4 py-3 last:border-b-0">
      <Globe2 className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-[9px] tracking-wider text-muted-foreground uppercase">
          {label}
        </span>
        <span
          className={`mt-0.5 block truncate font-mono text-xs ${copyable ? "text-foreground" : "text-muted-foreground"}`}
          title={value}
        >
          {value}
        </span>
      </span>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={!copyable}
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={() => void copyValue()}
      >
        {copied ? <Check className="text-emerald-400" /> : <Copy />}
      </Button>
    </div>
  )
}

function InstanceUsersCard({
  instance,
}: {
  instance: InstanceSettingsInstance
}) {
  const queryClient = useQueryClient()
  const usersQuery = useQuery(
    instanceUsersQueryOptions(instance.relayId, instance.id)
  )
  const [permissionsUser, setPermissionsUser] = React.useState<string | null>(
    null
  )
  const [removeTarget, setRemoveTarget] = React.useState<
    InstanceUsers["users"][number] | null
  >(null)
  const removeMutation = useMutation({
    mutationFn: removeInstanceAccessGrant,
    onSuccess: async () => {
      setRemoveTarget(null)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.access.instanceUsers(
            instance.relayId,
            instance.id
          ),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.access.overview }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.access.capabilities,
        }),
      ])
    },
  })

  const closeRemoveDialog = (open: boolean) => {
    if (open || removeMutation.isPending) return
    setRemoveTarget(null)
    removeMutation.reset()
  }

  return (
    <InfoCard>
      <InfoCardHeader
        icon={<Users />}
        title="Users"
        action={
          usersQuery.data?.canOpenAccessPage ? (
            <Button asChild size="sm" variant="ghost">
              <Link to="/access">
                Manage
                <ArrowRight />
              </Link>
            </Button>
          ) : (
            <Button size="sm" variant="ghost" disabled>
              Manage
              <ArrowRight />
            </Button>
          )
        }
      />

      {usersQuery.isPending ? (
        <div className="grid min-h-28 place-items-center text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
        </div>
      ) : usersQuery.isError ? (
        <div className="px-4 py-6 text-xs text-destructive">
          User access could not be loaded.
        </div>
      ) : (
        <table className="w-full table-fixed text-left">
          <thead>
            <tr className="border-b text-[9px] tracking-wider text-muted-foreground uppercase">
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="w-32 px-4 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            <AccessUserRow
              email={usersQuery.data.creator?.email ?? "Unknown creator"}
              userId={usersQuery.data.creator?.id ?? null}
              instanceId={instance.id}
              creator
            />
            {usersQuery.data.users.map((user) => (
              <AccessUserRow
                key={user.id}
                email={user.email}
                userId={user.userId}
                instanceId={instance.id}
                canManage={usersQuery.data.canManage}
                onPermissions={() => setPermissionsUser(user.email)}
                onRemove={() => setRemoveTarget(user)}
              />
            ))}
            {usersQuery.data.users.length === 0 ? (
              <tr>
                <td
                  colSpan={2}
                  className="px-4 py-4 text-[10px] text-muted-foreground"
                >
                  No additional users have access to this server.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}

      <Dialog
        open={permissionsUser !== null}
        onOpenChange={(open) => {
          if (!open) setPermissionsUser(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modify permissions</DialogTitle>
            <DialogDescription>
              Per-user permission editing for {permissionsUser ?? "this user"}{" "}
              is coming soon.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-dashed bg-muted/15 px-4 py-6 text-center font-mono text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
            Coming soon
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={removeTarget !== null} onOpenChange={closeRemoveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove server access?</DialogTitle>
            <DialogDescription>
              {removeTarget?.email ?? "This user"} will no longer be able to
              access {instance.name}.
            </DialogDescription>
          </DialogHeader>
          {removeMutation.error ? (
            <p className="text-xs text-destructive">
              {removeMutation.error instanceof Error
                ? removeMutation.error.message
                : "Could not remove server access"}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={removeMutation.isPending}
              onClick={() => closeRemoveDialog(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!removeTarget || removeMutation.isPending}
              onClick={() => {
                if (!removeTarget) return
                removeMutation.mutate({
                  data: {
                    id: removeTarget.id,
                    instanceId: instance.id,
                    relayId: instance.relayId,
                  },
                })
              }}
            >
              {removeMutation.isPending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Trash2 />
              )}
              Remove access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </InfoCard>
  )
}

function AccessUserRow({
  canManage = false,
  creator = false,
  email,
  instanceId,
  onPermissions,
  onRemove,
  userId,
}: {
  canManage?: boolean
  creator?: boolean
  email: string
  instanceId: string
  onPermissions?: () => void
  onRemove?: () => void
  userId: string | null
}) {
  return (
    <tr className="border-b last:border-b-0">
      <td className="px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs" title={email}>
            {email}
          </span>
          {creator ? (
            <Badge variant="outline" className="font-mono text-[8px]">
              Creator
            </Badge>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-2">
        <div className="flex justify-end gap-0.5">
          {userId ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild size="icon-sm" variant="ghost">
                  <Link
                    to="/activity"
                    search={{ server: instanceId, user: userId }}
                    aria-label={`View ${email} activity`}
                  >
                    <Activity />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">View activity</TooltipContent>
            </Tooltip>
          ) : null}
          {!creator && canManage ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Modify ${email} permissions`}
                    onClick={onPermissions}
                  >
                    <Pencil />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Modify permissions
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${email}`}
                    onClick={onRemove}
                  >
                    <Trash2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Remove user</TooltipContent>
              </Tooltip>
            </>
          ) : null}
        </div>
      </td>
    </tr>
  )
}

function ServerDangerZone({
  instance,
  onDeleted,
  relayConnected,
}: {
  instance: InstanceSettingsInstance
  onDeleted: () => Promise<void> | void
  relayConnected: boolean
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <div className="mt-8 overflow-hidden rounded-xl border border-destructive/25 bg-destructive/4">
        <div className="flex items-start gap-3 border-b border-destructive/15 px-4 py-3.5">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-destructive/20 bg-destructive/10 text-destructive">
            <TriangleAlert className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[9px] tracking-[0.16em] text-destructive uppercase">
              Danger zone
            </p>
            <h3 className="mt-1 text-sm font-semibold">Delete this server</h3>
            <p className="mt-1 max-w-2xl text-[10px] leading-4 text-muted-foreground">
              {relayConnected
                ? "Permanently remove this server and everything stored in its data directory."
                : "Reconnect this server's Relay before deleting the server."}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[9px] text-muted-foreground">
            {instance.id}
          </p>
          <Button
            type="button"
            variant="destructive"
            className="sm:shrink-0"
            disabled={!relayConnected}
            onClick={() => setOpen(true)}
          >
            <Trash2 />
            Delete server
          </Button>
        </div>
      </div>
      {open ? (
        <ServerDeleteDialog
          open
          target={{
            id: instance.id,
            name: instance.name,
            relayId: instance.relayId,
          }}
          onDeleted={onDeleted}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  )
}

function InstanceNameForm({
  instance,
  canRename,
}: {
  instance: InstanceSettingsInstance
  canRename: boolean
}) {
  const queryClient = useQueryClient()
  const updateNameMutation = useMutation({
    mutationFn: updateInstanceName,
    onSuccess: (updated) => {
      queryClient.setQueryData<RelayFleetSnapshot>(
        queryKeys.relay.snapshot,
        (snapshot) => replaceRelaySnapshotInstance(snapshot, updated)
      )
    },
  })
  const [draftName, setDraftName] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const name = draftName ?? instance.name

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextName = name.trim()
    if (!nextName || nextName === instance.name || pending) return
    setPending(true)
    setSaved(false)
    setError(null)
    await Effect.runPromise(
      Effect.tryPromise({
        try: () =>
          updateNameMutation.mutateAsync({
            data: {
              instanceId: instance.id,
              relayId: instance.relayId,
              name: nextName,
            },
          }),
        catch: (cause) => cause,
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setDraftName(null)
            setSaved(true)
            window.setTimeout(() => setSaved(false), 1800)
          })
        ),
        Effect.catch((cause) =>
          Effect.sync(() =>
            setError(
              cause instanceof Error
                ? cause.message
                : "Could not save instance name"
            )
          )
        ),
        Effect.ensuring(Effect.sync(() => setPending(false)))
      )
    )
  }

  return (
    <form
      className="border-b px-4 py-3"
      onSubmit={(event) => void saveName(event)}
    >
      <div className="flex items-center gap-2">
        <Server className="size-3.5 shrink-0 text-muted-foreground" />
        <label
          htmlFor="instance-display-name"
          className="text-[9px] tracking-wider text-muted-foreground uppercase"
        >
          Display name
        </label>
      </div>
      <div className="mt-2 flex gap-2">
        <Input
          id="instance-display-name"
          value={name}
          onChange={(event) => {
            setDraftName(event.target.value)
            setSaved(false)
            setError(null)
          }}
          maxLength={120}
          disabled={!canRename || pending}
          aria-invalid={Boolean(error)}
          className="h-9 min-w-0 flex-1"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="h-9 shrink-0"
          disabled={
            !canRename ||
            pending ||
            !name.trim() ||
            name.trim() === instance.name
          }
        >
          {pending ? (
            <LoaderCircle className="animate-spin" />
          ) : saved ? (
            <Check />
          ) : (
            <Save />
          )}
          {pending ? "Saving" : saved ? "Saved" : "Save"}
        </Button>
      </div>
      <p
        className={`mt-1.5 text-[9px] ${error ? "text-destructive" : "text-muted-foreground"}`}
      >
        {error ??
          (canRename
            ? "The display name can change without changing the server ID."
            : "You do not have permission to rename this server.")}
      </p>
    </form>
  )
}

function MetaRow({
  icon: Icon,
  label,
  value,
  mono = false,
  wrap = false,
}: {
  icon: typeof Server
  label: string
  value: string
  mono?: boolean
  wrap?: boolean
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 border-b px-4 py-3 last:border-b-0">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-[9px] tracking-wider text-muted-foreground uppercase">
          {label}
        </span>
        <span
          className={`mt-0.5 block text-xs ${mono ? "font-mono" : "font-medium"} ${wrap ? "break-all" : "truncate"}`}
          title={value}
        >
          {value}
        </span>
      </span>
    </div>
  )
}
