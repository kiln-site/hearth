import * as React from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  AlertTriangle,
  BrickWall,
  Cable,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Globe2,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCw,
  Trash2,
} from "lucide-react"
import {
  relayInstancePortInputSchema,
  relayInstanceWebRouteInputSchema,
} from "@workspace/contracts"
import type {
  RelayInstancePendingPrimaryPort,
  RelayInstancePortAllocation,
  RelayInstancePortInput,
  RelayInstancePortLease,
  RelayInstancePortProtocol,
  RelayInstanceWebRoute,
  RelayInstanceWebRouteInput,
  RelayInstanceWebRouteState,
} from "@workspace/contracts"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { showToast } from "@workspace/ui/components/sonner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import {
  useInstanceIdentity,
  useInstancePermissions,
  useInstanceRelayConnected,
} from "@/components/instance-workspace-context"
import {
  GameServerTailscaleSection,
  TailscaleNetworkMembershipPage,
} from "@/components/tailscale-network-membership"
import {
  WorkspaceTableCell,
  WorkspaceTableHead,
  WorkspaceTableHeading,
} from "@/components/workspace-data-table"
import {
  accessCapabilitiesQueryOptions,
  queryKeys,
  replaceRelaySnapshotInstance,
} from "@/lib/query-options"
import type { RelayFleetSnapshot } from "@/lib/relay-fleet"
import type { InstanceWorkspaceInstance } from "@/lib/relay-selectors"
import {
  getInstanceWebRoutes,
  performRelayAction,
  releaseInstancePort,
  reserveInstancePort,
  updateInstancePorts,
  updateInstanceWebRoutes,
} from "@/server/relay"

export function InstanceNetworkPage({
  editGamePort = false,
  highlightedTailscaleMember,
}: {
  editGamePort?: boolean
  highlightedTailscaleMember?: string
}) {
  const instance = useInstanceIdentity()
  const { data: isPlatformAdmin } = useSuspenseQuery({
    ...accessCapabilitiesQueryOptions(),
    select: (capabilities) => capabilities.isPlatformAdmin,
  })

  if (instance.implementation.toLowerCase() === "tailscale") {
    return isPlatformAdmin ? (
      <TailscaleNetworkMembershipPage
        highlightedServerKey={highlightedTailscaleMember}
        stackId={instance.id}
      />
    ) : (
      <div className="grid min-h-0 flex-1 place-items-center bg-background/55">
        <p className="text-sm text-muted-foreground">
          Platform administrator access is required to configure this network.
        </p>
      </div>
    )
  }

  return (
    <WebRoutesNetworkPage
      editGamePort={editGamePort}
      showTailscale={isPlatformAdmin}
    />
  )
}

function WebRoutesNetworkPage({
  editGamePort,
  showTailscale,
}: {
  editGamePort: boolean
  showTailscale: boolean
}) {
  const instance = useInstanceIdentity()
  const permissions = useInstancePermissions()
  const relayConnected = useInstanceRelayConnected()
  const queryClient = useQueryClient()
  const queryKey = React.useMemo(
    () => ["relay", instance.relayId, "web-routes", instance.id] as const,
    [instance.id, instance.relayId]
  )
  const routes = useQuery({
    enabled: permissions.networkRead,
    queryFn: () =>
      getInstanceWebRoutes({
        data: { instanceId: instance.id, relayId: instance.relayId },
      }),
    queryKey,
  })
  const update = useMutation({
    mutationFn: (next: Array<RelayInstanceWebRouteInput>) =>
      updateInstanceWebRoutes({
        data: {
          instanceId: instance.id,
          relayId: instance.relayId,
          routes: next,
        },
      }),
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
  })
  const restart = useMutation({
    mutationFn: () =>
      performRelayAction({
        data: {
          action: "restart",
          instanceId: instance.id,
          relayId: instance.relayId,
        },
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData<RelayFleetSnapshot>(
        queryKeys.relay.snapshot,
        (snapshot) => replaceRelaySnapshotInstance(snapshot, updated)
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.relay.snapshot,
        }),
      ])
    },
  })
  const restartPendingRoutes = React.useCallback(() => {
    if (!permissions.power || !relayConnected || restart.isPending) return
    restart.mutate()
  }, [permissions.power, relayConnected, restart])

  const addWebRoute = React.useCallback(
    async (route: RelayInstanceWebRouteInput) => {
      if (!routes.data) throw new Error("Routes are not loaded yet")
      await update.mutateAsync([...routes.data.routes, route])
    },
    [routes.data, update]
  )
  const editWebRoute = React.useCallback(
    async (route: RelayInstanceWebRouteInput) => {
      if (!route.id || !routes.data) {
        throw new Error("The web route is not loaded yet")
      }
      await update.mutateAsync(
        routes.data.routes.map((existing) =>
          existing.id === route.id ? route : existing
        )
      )
    },
    [routes.data, update]
  )
  const removeWebRoute = React.useCallback(
    (routeId: string) =>
      update.mutateAsync(
        (routes.data?.routes ?? []).filter((route) => route.id !== routeId)
      ),
    [routes.data?.routes, update]
  )

  if (!permissions.networkRead) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center bg-background/55">
        <p className="text-sm text-muted-foreground">
          You do not have permission to view network routes.
        </p>
      </div>
    )
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background/55 p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <ConfiguredRoutesSection
          key={editGamePort ? "edit-game-port" : "network"}
          canRestart={permissions.power && relayConnected}
          canWrite={permissions.networkWrite}
          editGamePort={editGamePort}
          instance={instance}
          relayConnected={relayConnected}
          routeError={routes.error ?? update.error}
          routePending={update.isPending}
          routeState={routes.data}
          routes={routes.data?.routes}
          restarting={restart.isPending}
          onAddWebRoute={addWebRoute}
          onEditWebRoute={editWebRoute}
          onRemoveWebRoute={removeWebRoute}
          onRestart={restartPendingRoutes}
        />
        {showTailscale ? (
          <GameServerTailscaleSection server={instance} />
        ) : null}
      </div>
    </main>
  )
}

type RouteDialogState =
  | { mode: "add" }
  | { allocation: RelayInstancePortAllocation; mode: "edit-port" }
  | { mode: "edit-web"; route: RelayInstanceWebRoute }
  | { mode: "recover-primary" }
  | null

const ConfiguredRoutesSection = React.memo(function ConfiguredRoutesSection({
  canRestart,
  canWrite,
  editGamePort,
  instance,
  relayConnected,
  routeError,
  routePending,
  routeState,
  routes,
  restarting,
  onAddWebRoute,
  onEditWebRoute,
  onRemoveWebRoute,
  onRestart,
}: {
  canRestart: boolean
  canWrite: boolean
  editGamePort: boolean
  instance: InstanceWorkspaceInstance
  relayConnected: boolean
  routeError: unknown
  routePending: boolean
  routeState: RelayInstanceWebRouteState | undefined
  routes: Array<RelayInstanceWebRoute> | undefined
  restarting: boolean
  onAddWebRoute: (route: RelayInstanceWebRouteInput) => Promise<void>
  onEditWebRoute: (route: RelayInstanceWebRouteInput) => Promise<void>
  onRemoveWebRoute: (routeId: string) => Promise<unknown>
  onRestart: () => void
}) {
  const navigate = useNavigate({ from: "/server/$serverId/network" })
  const queryClient = useQueryClient()
  const primaryPort = instance.ports.find(
    (allocation) => allocation.kind === "primary"
  )
  const pendingPrimaryPort = primaryPort
    ? undefined
    : instance.pendingPrimaryPort
  const [dialog, setDialog] = React.useState<RouteDialogState>(() =>
    editGamePort && canWrite
      ? primaryPort
        ? { allocation: primaryPort, mode: "edit-port" }
        : { mode: "recover-primary" }
      : null
  )
  const clearEditGamePortIntent = React.useCallback(() => {
    if (!editGamePort) return
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, edit: undefined }),
    })
  }, [editGamePort, navigate])
  const update = useMutation({
    mutationFn: (ports: Array<RelayInstancePortInput>) =>
      updateInstancePorts({
        data: {
          instanceId: instance.id,
          ports,
          relayId: instance.relayId,
        },
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData<RelayFleetSnapshot>(
        queryKeys.relay.snapshot,
        (snapshot) => replaceRelaySnapshotInstance(snapshot, updated)
      )
      setDialog(null)
      clearEditGamePortIntent()
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.relay.connection,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.relay.snapshot,
        }),
      ])
      showToast({
        description: updated.pendingPrimaryPort
          ? "Restart the server when you are ready to apply it."
          : undefined,
        message: updated.pendingPrimaryPort
          ? "Default Server saved"
          : "Port allocations updated",
        type: "success",
      })
    },
  })
  const disabled =
    !canWrite || !instance.managedByRelay || !relayConnected || update.isPending
  const portInputs = React.useMemo(
    () =>
      instance.ports.map(({ id, internalPort, name, protocol }) => ({
        id,
        internalPort,
        name,
        protocol,
      })),
    [instance.ports]
  )
  const applyPort = React.useCallback(
    async (port: RelayInstancePortInput) => {
      const ports =
        dialog?.mode === "edit-port"
          ? portInputs.map((existing) =>
              existing.id === dialog.allocation.id ? port : existing
            )
          : dialog?.mode === "recover-primary"
            ? [port, ...portInputs]
            : [...portInputs, port]
      await update.mutateAsync(ports)
    },
    [dialog, portInputs, update]
  )
  const removePort = React.useCallback(
    (allocation: RelayInstancePortAllocation) => {
      if (allocation.kind !== "custom" || disabled) return
      if (!window.confirm(`Remove ${allocation.name} from this server?`)) return
      update.mutate(portInputs.filter((port) => port.id !== allocation.id))
    },
    [disabled, portInputs, update]
  )
  const editPort = React.useCallback(
    (allocation: RelayInstancePortAllocation) => {
      update.reset()
      setDialog({ allocation, mode: "edit-port" })
    },
    [update]
  )
  const recoverPrimaryPort = React.useCallback(() => {
    update.reset()
    setDialog({ mode: "recover-primary" })
  }, [update])
  const editWebRoute = React.useCallback((route: RelayInstanceWebRoute) => {
    setDialog({ mode: "edit-web", route })
  }, [])
  const removeWebRoute = React.useCallback(
    (route: RelayInstanceWebRoute) => {
      if (disabled || routePending) return
      if (!window.confirm(`Remove ${route.hostname} from this server?`)) return
      void onRemoveWebRoute(route.id).catch(() => undefined)
    },
    [disabled, onRemoveWebRoute, routePending]
  )

  return (
    <section className="border border-border/80 bg-card/55">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div>
          <h1 className="font-heading text-base font-semibold tracking-tight">
            Configured routes
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {routeState && routeState.routes.length === 0 ? (
            <RouteStatusButton
              canRestart={canRestart}
              restarting={restarting}
              state={routeState}
              onRestart={onRestart}
            />
          ) : null}
          {canWrite ? (
            <Button
              disabled={disabled || routes === undefined}
              onClick={() => {
                update.reset()
                setDialog({ mode: "add" })
              }}
              size="sm"
              type="button"
            >
              <Plus />
              Add route
            </Button>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto">
        <ConfiguredRoutesTable
          canWrite={canWrite}
          disabled={disabled}
          instance={instance}
          canRestart={canRestart}
          routePending={routePending}
          routeState={routeState}
          routes={routes}
          restarting={restarting}
          onEditPort={editPort}
          onEditWebRoute={editWebRoute}
          onRecoverPrimaryPort={recoverPrimaryPort}
          onRemovePort={removePort}
          onRemoveWebRoute={removeWebRoute}
          onRestart={onRestart}
        />
      </div>

      {!relayConnected ? (
        <p className="border-t border-amber-400/20 bg-amber-400/5 px-4 py-2 text-[11px] text-amber-100/75">
          Port changes are unavailable while this Relay is disconnected.
        </p>
      ) : (update.error || routeError) && dialog === null ? (
        <p className="border-t border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {errorMessage(update.error ?? routeError)}
        </p>
      ) : null}

      {dialog?.mode === "add" || dialog?.mode === "edit-web" ? (
        <AddNetworkRouteDialog
          canAddPort={primaryPort !== undefined && instance.ports.length < 16}
          canAddWebRoute={(routes?.length ?? 16) < 16}
          canEditPublicPort={canWrite}
          error={
            update.error || routeError
              ? errorMessage(update.error ?? routeError)
              : null
          }
          pending={update.isPending || routePending}
          instanceId={instance.id}
          relayId={instance.relayId}
          webRoute={dialog.mode === "edit-web" ? dialog.route : undefined}
          onOpenChange={(open) => {
            if (!open && !update.isPending && !routePending) setDialog(null)
          }}
          onSubmitPort={applyPort}
          onSubmitWebRoute={
            dialog.mode === "edit-web" ? onEditWebRoute : onAddWebRoute
          }
        />
      ) : null}
      <PortAllocationDialog
        key={
          dialog?.mode === "edit-port"
            ? dialog.allocation.id
            : dialog?.mode === "recover-primary"
              ? "recover-primary"
              : "closed"
        }
        allocation={dialog?.mode === "edit-port" ? dialog.allocation : null}
        canEditPublicPort={canWrite}
        error={update.error ? errorMessage(update.error) : null}
        open={
          dialog?.mode === "edit-port" || dialog?.mode === "recover-primary"
        }
        pending={update.isPending}
        instanceId={instance.id}
        relayId={instance.relayId}
        pendingPrimaryPort={
          dialog?.mode === "recover-primary"
            ? (pendingPrimaryPort ?? null)
            : null
        }
        recoveringPrimary={dialog?.mode === "recover-primary"}
        onOpenChange={(open) => {
          if (!open && !update.isPending) {
            setDialog(null)
            clearEditGamePortIntent()
          }
        }}
        onSubmit={applyPort}
      />
    </section>
  )
})

const ConfiguredRoutesTable = React.memo(function ConfiguredRoutesTable({
  canRestart,
  canWrite,
  disabled,
  instance,
  routePending,
  routeState,
  routes,
  restarting,
  onEditPort,
  onEditWebRoute,
  onRecoverPrimaryPort,
  onRemovePort,
  onRemoveWebRoute,
  onRestart,
}: {
  canRestart: boolean
  canWrite: boolean
  disabled: boolean
  instance: InstanceWorkspaceInstance
  routePending: boolean
  routeState: RelayInstanceWebRouteState | undefined
  routes: Array<RelayInstanceWebRoute> | undefined
  restarting: boolean
  onEditPort: (allocation: RelayInstancePortAllocation) => void
  onEditWebRoute: (route: RelayInstanceWebRoute) => void
  onRecoverPrimaryPort: () => void
  onRemovePort: (allocation: RelayInstancePortAllocation) => void
  onRemoveWebRoute: (route: RelayInstanceWebRoute) => void
  onRestart: () => void
}) {
  const primaryPort = instance.ports.find(
    (allocation) => allocation.kind === "primary"
  )
  const pendingPrimaryPort = primaryPort
    ? undefined
    : instance.pendingPrimaryPort
  const displayedPrimaryPort = primaryPort ?? pendingPrimaryPort
  const hasAdditionalRoutes =
    instance.ports.some((allocation) => allocation.kind !== "primary") ||
    Boolean(routes?.length)

  return (
    <table className="w-full min-w-[40rem] table-fixed border-collapse text-left">
      <WorkspaceTableHead>
        <WorkspaceTableHeading className="w-[27%]">Name</WorkspaceTableHeading>
        <WorkspaceTableHeading className="w-[15%]">
          Internal Port
        </WorkspaceTableHeading>
        <WorkspaceTableHeading>Public Address</WorkspaceTableHeading>
        <WorkspaceTableHeading className="w-[6.5rem] text-right">
          Actions
        </WorkspaceTableHeading>
      </WorkspaceTableHead>
      <tbody className="divide-y divide-border/70">
        <tr className="hover:bg-muted/10">
          <WorkspaceTableCell>
            <div className="flex min-w-0 items-center gap-2.5">
              <RouteRowIcon
                canRestart={canRestart}
                errorMessage={
                  displayedPrimaryPort
                    ? undefined
                    : "Edit the Default Server to assign its internal port and protocol."
                }
                kind="primary"
                pendingMessage={
                  pendingPrimaryPort
                    ? "Restart this server when you are ready to apply its Default Server route."
                    : undefined
                }
                restarting={restarting}
                onRestart={onRestart}
              />
              <div className="min-w-0">
                <span className="block truncate text-xs font-medium">
                  Default Server
                </span>
                <span className="mt-0.5 block font-mono text-[9px] text-muted-foreground uppercase">
                  {displayedPrimaryPort?.protocol ?? "Not configured"}
                </span>
              </div>
              <span className="shrink-0 self-center border border-primary/30 bg-primary/8 px-2 py-1 font-mono text-[9px] leading-none tracking-[0.1em] text-primary uppercase">
                Primary
              </span>
            </div>
          </WorkspaceTableCell>
          <WorkspaceTableCell>
            <span className="font-mono text-xs text-foreground">
              {displayedPrimaryPort?.internalPort ?? "—"}
            </span>
          </WorkspaceTableCell>
          <WorkspaceTableCell>
            <PublicAddressCopy
              address={
                instance.publicHost && primaryPort
                  ? formatHostPort(
                      instance.publicHost,
                      primaryPort.externalPort
                    )
                  : null
              }
              label="game server public address"
              prominent
            />
          </WorkspaceTableCell>
          <WorkspaceTableCell className="px-2">
            <div className="flex justify-end">
              {canWrite ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label="Edit Default Server"
                      disabled={disabled}
                      onClick={() => {
                        if (primaryPort) onEditPort(primaryPort)
                        else onRecoverPrimaryPort()
                      }}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Pencil />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {primaryPort
                      ? "Edit allocation"
                      : pendingPrimaryPort
                        ? "Edit pending Default Server"
                        : "Assign Default Server"}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </WorkspaceTableCell>
        </tr>
        {hasAdditionalRoutes ? (
          <tr aria-hidden="true">
            <td
              className="h-3 border-y border-border/70 bg-muted/25 p-0"
              colSpan={4}
            />
          </tr>
        ) : null}
        {instance.ports.map((allocation) => {
          if (allocation.kind === "primary") return null
          const address = instance.publicHost
            ? formatHostPort(instance.publicHost, allocation.externalPort)
            : null
          return (
            <tr key={allocation.id} className="hover:bg-muted/10">
              <WorkspaceTableCell>
                <div className="flex min-w-0 items-center gap-2.5">
                  <RouteRowIcon kind="port" />
                  <div className="min-w-0">
                    <span className="block truncate text-xs font-medium">
                      {allocation.name}
                    </span>
                    <span className="mt-0.5 block font-mono text-[9px] text-muted-foreground uppercase">
                      {allocation.protocol}
                    </span>
                  </div>
                </div>
              </WorkspaceTableCell>
              <WorkspaceTableCell>
                <span className="font-mono text-xs text-foreground">
                  {allocation.internalPort}
                </span>
              </WorkspaceTableCell>
              <WorkspaceTableCell>
                <PublicAddressCopy
                  address={address}
                  label={`${allocation.name} public address`}
                  prominent
                />
              </WorkspaceTableCell>
              <WorkspaceTableCell className="px-2">
                <div className="flex justify-end gap-0.5">
                  {canWrite ? (
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            aria-label={`Edit ${allocation.name}`}
                            disabled={disabled}
                            onClick={() => onEditPort(allocation)}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <Pencil />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit allocation</TooltipContent>
                      </Tooltip>
                      {allocation.kind === "custom" ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              aria-label={`Remove ${allocation.name}`}
                              disabled={disabled}
                              onClick={() => onRemovePort(allocation)}
                              size="icon-sm"
                              type="button"
                              variant="ghost"
                            >
                              <Trash2 />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Remove allocation</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </WorkspaceTableCell>
            </tr>
          )
        })}
        {routes?.map((route) => {
          const publicUrl = `https://${route.hostname}${route.path ?? ""}`
          return (
            <tr key={`web-${route.id}`} className="hover:bg-muted/10">
              <WorkspaceTableCell>
                <div className="flex min-w-0 items-center gap-2.5">
                  <RouteRowIcon
                    canRestart={canRestart}
                    kind="web"
                    restarting={restarting}
                    state={routeState}
                    onRestart={onRestart}
                  />
                  <div className="min-w-0">
                    <span className="block truncate text-xs font-medium">
                      {route.hostname}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[9px] text-muted-foreground">
                      <span className="uppercase">HTTPS</span>
                      {route.path ? ` · ${route.path}` : ""}
                    </span>
                  </div>
                </div>
              </WorkspaceTableCell>
              <WorkspaceTableCell>
                <span className="font-mono text-xs text-foreground">
                  {route.targetPort}
                </span>
              </WorkspaceTableCell>
              <WorkspaceTableCell>
                <PublicAddressCopy
                  address={publicUrl}
                  label={`${route.hostname} web route`}
                  prominent
                />
              </WorkspaceTableCell>
              <WorkspaceTableCell className="px-2">
                <div className="flex justify-end gap-0.5">
                  {canWrite ? (
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            aria-label={`Edit ${publicUrl}`}
                            disabled={disabled || routePending}
                            onClick={() => onEditWebRoute(route)}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <Pencil />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit web route</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            aria-label={`Remove ${publicUrl}`}
                            disabled={disabled || routePending}
                            onClick={() => onRemoveWebRoute(route)}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <Trash2 />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Remove web route</TooltipContent>
                      </Tooltip>
                    </>
                  ) : null}
                </div>
              </WorkspaceTableCell>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
})

const RouteRowIcon = React.memo(function RouteRowIcon({
  canRestart = false,
  errorMessage,
  kind,
  pendingMessage,
  restarting = false,
  state,
  onRestart,
}: {
  canRestart?: boolean
  errorMessage?: string
  kind: "port" | "primary" | "web"
  pendingMessage?: string
  restarting?: boolean
  state?: RelayInstanceWebRouteState
  onRestart?: () => void
}) {
  const pending =
    pendingMessage !== undefined || state?.status === "pending_restart"
  const blocked = state?.status === "blocked" || errorMessage !== undefined
  const Icon = kind === "primary" ? BrickWall : kind === "web" ? Globe2 : Cable

  if (!pending && !blocked) {
    return (
      <div
        className={`grid size-7 shrink-0 place-items-center border ${
          kind === "primary"
            ? "border-primary/30 bg-primary/5 text-primary"
            : "border-emerald-400/25 bg-emerald-400/5 text-emerald-300"
        }`}
      >
        <Icon className="size-3.5" />
      </div>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={
            pending
              ? "View Default Server restart warning"
              : errorMessage
                ? "View Default Server error"
                : "View route error"
          }
          className={`grid size-7 shrink-0 place-items-center border transition-colors ${
            pending
              ? "border-amber-400/30 bg-amber-400/5 text-amber-300 hover:bg-amber-400/10"
              : "border-destructive/35 bg-destructive/5 text-destructive hover:bg-destructive/10"
          }`}
          onClick={() => {
            if (errorMessage) {
              showToast({
                description: errorMessage,
                message: "Default Server is not configured",
                type: "error",
              })
              return
            }
            if (pendingMessage) {
              showPendingRestartToast({
                canRestart,
                message: pendingMessage,
                restarting,
                onRestart,
              })
              return
            }
            if (!state) return
            showRouteStatusToast({
              canRestart,
              restarting,
              state,
              onRestart,
            })
          }}
          type="button"
        >
          {pending ? (
            <AlertTriangle className="size-3.5" />
          ) : (
            <CircleAlert className="size-3.5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {pending
          ? "Restart required"
          : errorMessage
            ? "Default Server needs configuration"
            : "View route error"}
      </TooltipContent>
    </Tooltip>
  )
})

const PublicAddressCopy = React.memo(function PublicAddressCopy({
  address,
  label,
  prominent = false,
}: {
  address: string | null
  label: string
  prominent?: boolean
}) {
  const { copied, copy } = useCopyFeedback(address ?? "")

  if (!address) {
    return (
      <span className="block truncate font-mono text-[10px] text-muted-foreground">
        Unavailable
      </span>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={`Copy ${label}`}
          className={`flex max-w-full items-center gap-1 font-mono transition-colors ${
            prominent ? "text-sm font-medium" : "text-[10px]"
          } ${
            copied ? "text-emerald-400" : "text-primary/75 hover:text-primary"
          }`}
          onClick={() => {
            void copy()
          }}
          type="button"
        >
          <span className="truncate">{address}</span>
          {copied ? (
            <Check className="size-3 shrink-0" />
          ) : (
            <Copy className="size-3 shrink-0 opacity-55" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {copied ? "Address copied" : "Copy address"}
      </TooltipContent>
    </Tooltip>
  )
})

function useCopyFeedback(value: string) {
  const [copied, setCopied] = React.useState(false)
  const resetTimer = React.useRef<number | null>(null)
  React.useEffect(
    () => () => {
      if (resetTimer.current) window.clearTimeout(resetTimer.current)
    },
    []
  )

  async function copy() {
    await copyToClipboard(value)
    setCopied(true)
    if (resetTimer.current) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setCopied(false), 1_800)
  }

  return { copied, copy }
}

function usePortLease({
  enabled,
  instanceId,
  protocol,
  relayId,
}: {
  enabled: boolean
  instanceId: string
  protocol: RelayInstancePortProtocol
  relayId: string
}) {
  const [error, setError] = React.useState<string | null>(null)
  const [lease, setLease] = React.useState<RelayInstancePortLease | null>(null)
  const [pending, setPending] = React.useState(enabled)
  const [portValue, setPortValueState] = React.useState("")
  const generation = React.useRef(0)
  const leaseRef = React.useRef<RelayInstancePortLease | null>(null)
  const portDirty = React.useRef(false)

  React.useEffect(() => {
    const currentGeneration = generation.current + 1
    generation.current = currentGeneration
    if (!enabled) {
      leaseRef.current = null
      setError(null)
      setLease(null)
      setPending(false)
      setPortValueState("")
      return
    }

    setError(null)
    setLease(null)
    setPending(true)
    setPortValueState("")
    portDirty.current = false
    void reserveInstancePort({
      data: { instanceId, protocol, relayId },
    })
      .then((nextLease) => {
        if (generation.current !== currentGeneration) {
          void releaseInstancePort({
            data: { instanceId, leaseId: nextLease.id, relayId },
          }).catch(() => undefined)
          return
        }
        leaseRef.current = nextLease
        setLease(nextLease)
        setPortValueState(String(nextLease.externalPort))
      })
      .catch((cause: unknown) => {
        if (generation.current === currentGeneration) {
          setError(errorMessage(cause))
        }
      })
      .finally(() => {
        if (generation.current === currentGeneration) setPending(false)
      })

    return () => {
      generation.current += 1
      const currentLease = leaseRef.current
      leaseRef.current = null
      if (currentLease) {
        void releaseInstancePort({
          data: { instanceId, leaseId: currentLease.id, relayId },
        }).catch(() => undefined)
      }
    }
  }, [enabled, instanceId, protocol, relayId])

  React.useEffect(() => {
    if (!enabled || !lease) return
    let cancelled = false
    let timer = window.setTimeout(renew, 30_000)

    async function renew() {
      const currentLease = leaseRef.current
      if (!currentLease || currentLease.id !== lease?.id) return
      try {
        const nextLease = await reserveInstancePort({
          data: {
            instanceId,
            leaseId: currentLease.id,
            protocol,
            relayId,
          },
        })
        if (cancelled || leaseRef.current?.id !== currentLease.id) {
          void releaseInstancePort({
            data: { instanceId, leaseId: nextLease.id, relayId },
          }).catch(() => undefined)
          return
        }
        leaseRef.current = nextLease
        setLease(nextLease)
        if (!portDirty.current) {
          setPortValueState(String(nextLease.externalPort))
        }
        setError(null)
      } catch (cause) {
        if (!cancelled) {
          setError(errorMessage(cause))
          timer = window.setTimeout(renew, 10_000)
        }
      }
    }

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [enabled, instanceId, lease, protocol, relayId])

  const setPortValue = React.useCallback((value: string) => {
    portDirty.current = true
    setPortValueState(value)
  }, [])

  const commit = React.useCallback(async () => {
    const currentLease = leaseRef.current
    if (!currentLease) throw new Error("Public port is still being reserved")
    const externalPort = Number(portValue)
    if (
      !Number.isInteger(externalPort) ||
      externalPort < 1 ||
      externalPort > 65_535
    ) {
      throw new Error("Public Port must be between 1 and 65535")
    }
    if (externalPort === currentLease.externalPort) {
      portDirty.current = false
      return currentLease
    }

    setPending(true)
    setError(null)
    const currentGeneration = generation.current
    try {
      const nextLease = await reserveInstancePort({
        data: {
          externalPort,
          instanceId,
          leaseId: currentLease.id,
          protocol,
          relayId,
        },
      })
      if (generation.current !== currentGeneration) {
        void releaseInstancePort({
          data: { instanceId, leaseId: nextLease.id, relayId },
        }).catch(() => undefined)
        throw new Error("Port reservation dialog was closed")
      }
      leaseRef.current = nextLease
      portDirty.current = false
      setLease(nextLease)
      setPortValueState(String(nextLease.externalPort))
      return nextLease
    } catch (cause) {
      if (generation.current === currentGeneration) {
        setError(errorMessage(cause))
      }
      throw cause
    } finally {
      if (generation.current === currentGeneration) {
        setPending(false)
      }
    }
  }, [instanceId, portValue, protocol, relayId])

  return {
    commit,
    error,
    lease,
    pending,
    portValue,
    setPortValue,
  }
}

function ProtocolSelect({
  disabled = false,
  value,
  onChange,
}: {
  disabled?: boolean
  value: RelayInstancePortProtocol
  onChange: (protocol: RelayInstancePortProtocol) => void
}) {
  return (
    <div className="relative">
      <select
        aria-label="Protocol"
        className="flex h-8 w-full appearance-none rounded-md border border-input bg-transparent py-1 pr-8 pl-3 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-55"
        disabled={disabled}
        name="protocol"
        value={value}
        onChange={(event) => {
          const parsed = relayInstancePortInputSchema.shape.protocol.safeParse(
            event.target.value
          )
          if (parsed.success) onChange(parsed.data)
        }}
      >
        <option value="tcp">TCP</option>
        <option value="udp">UDP</option>
        <option value="both">TCP + UDP</option>
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

function AddNetworkRouteDialog({
  canAddPort,
  canAddWebRoute,
  canEditPublicPort,
  error,
  instanceId,
  pending,
  relayId,
  webRoute,
  onOpenChange,
  onSubmitPort,
  onSubmitWebRoute,
}: {
  canAddPort: boolean
  canAddWebRoute: boolean
  canEditPublicPort: boolean
  error: string | null
  instanceId: string
  pending: boolean
  relayId: string
  webRoute?: RelayInstanceWebRoute
  onOpenChange: (open: boolean) => void
  onSubmitPort: (port: RelayInstancePortInput) => Promise<void>
  onSubmitWebRoute: (route: RelayInstanceWebRouteInput) => Promise<void>
}) {
  const [routeType, setRouteType] = React.useState<"port" | "web">(
    webRoute ? "web" : canAddPort ? "port" : "web"
  )
  const [validationError, setValidationError] = React.useState<string | null>(
    null
  )
  const [protocol, setProtocol] =
    React.useState<RelayInstancePortProtocol>("tcp")
  const [internalPort, setInternalPort] = React.useState<string | null>(null)
  const portLease = usePortLease({
    enabled: routeType === "port" && canAddPort && !webRoute,
    instanceId,
    protocol,
    relayId,
  })
  const portPending = routeType === "port" && portLease.pending

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="font-mono text-[9px] tracking-[0.16em] text-primary uppercase">
            {webRoute ? "Web route" : "New route"}
          </p>
          <DialogTitle>
            {webRoute ? "Edit web route" : "Add a network route"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {webRoute
              ? "Update where this hostname forwards inside the Ember."
              : "Publish a raw TCP or UDP port, or forward a hostname to an HTTP service inside this Ember."}
          </DialogDescription>
        </DialogHeader>

        {!webRoute ? (
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            <Button
              aria-checked={routeType === "port"}
              className="h-auto items-start justify-start px-3 py-2.5 text-left"
              disabled={!canAddPort || pending}
              onClick={() => {
                setRouteType("port")
                setValidationError(null)
              }}
              role="radio"
              type="button"
              variant={routeType === "port" ? "default" : "outline"}
            >
              <Cable className="mt-0.5" />
              <span>
                <span className="block text-xs">Port</span>
                <span className="mt-0.5 block text-[9px] opacity-70">
                  TCP or UDP
                </span>
              </span>
            </Button>
            <Button
              aria-checked={routeType === "web"}
              className="h-auto items-start justify-start px-3 py-2.5 text-left"
              disabled={!canAddWebRoute || pending}
              onClick={() => {
                setRouteType("web")
                setValidationError(null)
              }}
              role="radio"
              type="button"
              variant={routeType === "web" ? "default" : "outline"}
            >
              <Globe2 className="mt-0.5" />
              <span>
                <span className="block text-xs">Web route</span>
                <span className="mt-0.5 block text-[9px] opacity-70">
                  HTTPS hostname
                </span>
              </span>
            </Button>
          </div>
        ) : null}

        <form
          key={webRoute?.id ?? routeType}
          action={async (form) => {
            if (routeType === "port") {
              const lease = await portLease.commit().catch((cause: unknown) => {
                setValidationError(errorMessage(cause))
                return null
              })
              if (!lease) return
              const parsed = relayInstancePortInputSchema.safeParse({
                externalPort: lease.externalPort,
                internalPort: Number(form.get("internalPort")),
                leaseId: lease.id,
                name: String(form.get("name") ?? ""),
                protocol,
              })
              if (!parsed.success) {
                setValidationError(
                  parsed.error.issues[0]?.message ??
                    "Port allocation is invalid"
                )
                return
              }
              setValidationError(null)
              await onSubmitPort(parsed.data).catch(() => undefined)
              return
            }

            const path = String(form.get("path") ?? "").trim()
            const parsed = relayInstanceWebRouteInputSchema.safeParse({
              id: webRoute?.id,
              hostname: String(form.get("hostname") ?? ""),
              path: path || null,
              stripPrefix: form.get("stripPrefix") === "on",
              targetPort: Number(form.get("targetPort")),
            })
            if (!parsed.success) {
              setValidationError(
                parsed.error.issues[0]?.message ?? "Web route is invalid"
              )
              return
            }
            setValidationError(null)
            await onSubmitWebRoute(parsed.data)
              .then(() => onOpenChange(false))
              .catch(() => undefined)
          }}
          className="space-y-4"
        >
          {routeType === "port" ? (
            <>
              <label className="block space-y-1.5 text-[11px] font-medium">
                Name
                <Input
                  autoComplete="off"
                  maxLength={32}
                  name="name"
                  placeholder="Voice chat"
                  required
                />
              </label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-[7.5rem_7.5rem_minmax(0,1fr)]">
                <label className="block space-y-1.5 text-[11px] font-medium">
                  Internal Port
                  <Input
                    max={65_535}
                    min={1}
                    name="internalPort"
                    placeholder="24454"
                    required
                    type="number"
                    value={internalPort ?? portLease.portValue}
                    onChange={(event) => setInternalPort(event.target.value)}
                  />
                </label>
                <label className="block space-y-1.5 text-[11px] font-medium">
                  Public Port
                  <Input
                    aria-label="Public Port"
                    className="font-mono"
                    disabled={!canEditPublicPort || portLease.pending}
                    max={65_535}
                    min={1}
                    readOnly={!canEditPublicPort}
                    type="number"
                    value={portLease.portValue}
                    onBlur={() => {
                      if (canEditPublicPort && portLease.lease) {
                        void portLease.commit().catch(() => undefined)
                      }
                    }}
                    onChange={(event) =>
                      portLease.setPortValue(event.target.value)
                    }
                  />
                </label>
                <label className="col-span-2 block space-y-1.5 text-[11px] font-medium sm:col-span-1">
                  Protocol
                  <ProtocolSelect value={protocol} onChange={setProtocol} />
                </label>
              </div>
            </>
          ) : (
            <>
              <label className="block space-y-1.5 text-[11px] font-medium">
                Hostname
                <Input
                  autoCapitalize="none"
                  autoCorrect="off"
                  defaultValue={webRoute?.hostname}
                  name="hostname"
                  placeholder="map.donutsmp.com"
                  required
                />
              </label>
              <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
                <label className="block space-y-1.5 text-[11px] font-medium">
                  Path (optional)
                  <Input
                    defaultValue={webRoute?.path ?? ""}
                    name="path"
                    placeholder="/map"
                  />
                </label>
                <label className="block space-y-1.5 text-[11px] font-medium">
                  Internal Port
                  <Input
                    defaultValue={webRoute?.targetPort}
                    max={65_535}
                    min={1}
                    name="targetPort"
                    placeholder="8080"
                    required
                    type="number"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <input
                  className="accent-primary"
                  defaultChecked={webRoute?.stripPrefix ?? true}
                  name="stripPrefix"
                  type="checkbox"
                />
                Strip the configured path before forwarding
              </label>
              <div className="flex gap-2 border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[10px] leading-relaxed text-amber-100/75">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
                Point this hostname at the Relay before applying the route.
              </div>
            </>
          )}

          {validationError || portLease.error || error ? (
            <p className="text-xs text-destructive">
              {validationError ?? portLease.error ?? error}
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose
              render={
                <Button disabled={pending} type="button" variant="outline" />
              }
            >
              Cancel
            </DialogClose>
            <Button disabled={pending || portPending} type="submit">
              {pending || portPending ? (
                <LoaderCircle className="animate-spin" />
              ) : webRoute ? (
                <Pencil />
              ) : (
                <Plus />
              )}
              {pending || portPending
                ? webRoute
                  ? "Applying"
                  : "Adding"
                : webRoute
                  ? "Save route"
                  : "Add route"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PortAllocationDialog({
  allocation,
  canEditPublicPort,
  error,
  instanceId,
  open,
  pending,
  pendingPrimaryPort,
  relayId,
  recoveringPrimary = false,
  onOpenChange,
  onSubmit,
}: {
  allocation: RelayInstancePortAllocation | null
  canEditPublicPort: boolean
  error: string | null
  instanceId: string
  open: boolean
  pending: boolean
  pendingPrimaryPort: RelayInstancePendingPrimaryPort | null
  relayId: string
  recoveringPrimary?: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (port: RelayInstancePortInput) => Promise<void>
}) {
  const [validationError, setValidationError] = React.useState<string | null>(
    null
  )
  const editing = allocation !== null || recoveringPrimary
  const isDefaultServer = recoveringPrimary || allocation?.kind === "primary"
  const [protocol, setProtocol] = React.useState<RelayInstancePortProtocol>(
    allocation?.protocol ?? pendingPrimaryPort?.protocol ?? "tcp"
  )
  const [internalPort, setInternalPort] = React.useState<string | null>(
    pendingPrimaryPort ? String(pendingPrimaryPort.internalPort) : null
  )
  const portLease = usePortLease({
    enabled: open && recoveringPrimary,
    instanceId,
    protocol,
    relayId,
  })
  const portPending = recoveringPrimary && portLease.pending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="font-mono text-[9px] tracking-[0.16em] text-primary uppercase">
            {isDefaultServer
              ? "Default Server"
              : editing
                ? "Port mapping"
                : "New allocation"}
          </p>
          <DialogTitle>
            {recoveringPrimary
              ? "Assign the Default Server"
              : isDefaultServer
                ? "Edit the Default Server"
                : editing
                  ? "Edit port allocation"
                  : "Allocate a port"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {recoveringPrimary
              ? "Choose the internal port and protocol used by this game server. Kiln assigns its public port automatically."
              : "Choose where traffic should arrive inside the Ember. Kiln assigns the public port automatically."}
          </DialogDescription>
        </DialogHeader>

        <form
          key={
            allocation?.id ??
            pendingPrimaryPort?.internalPort ??
            (recoveringPrimary ? "primary" : "new")
          }
          action={async (form) => {
            const lease = recoveringPrimary
              ? await portLease.commit().catch((cause: unknown) => {
                  setValidationError(errorMessage(cause))
                  return null
                })
              : null
            if (recoveringPrimary && !lease) return
            const parsed = relayInstancePortInputSchema.safeParse({
              externalPort: lease?.externalPort,
              id: allocation?.id ?? (recoveringPrimary ? "primary" : undefined),
              internalPort: Number(form.get("internalPort")),
              leaseId: lease?.id,
              name: isDefaultServer
                ? "Default Server"
                : String(form.get("name") ?? ""),
              protocol,
            })
            if (!parsed.success) {
              setValidationError(
                parsed.error.issues[0]?.message ?? "Port allocation is invalid"
              )
              return
            }
            setValidationError(null)
            await onSubmit(parsed.data).catch(() => undefined)
          }}
          className="space-y-4"
        >
          {isDefaultServer ? null : (
            <label className="block space-y-1.5 text-[11px] font-medium">
              Name
              <Input
                autoComplete="off"
                defaultValue={allocation?.name ?? ""}
                maxLength={32}
                name="name"
                placeholder="Voice chat"
                required
              />
            </label>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[7.5rem_7.5rem_minmax(0,1fr)]">
            <label className="block space-y-1.5 text-[11px] font-medium">
              Internal Port
              <Input
                defaultValue={allocation?.internalPort}
                max={65_535}
                min={1}
                name="internalPort"
                placeholder="24454"
                required
                type="number"
                value={
                  recoveringPrimary
                    ? (internalPort ?? portLease.portValue)
                    : undefined
                }
                onChange={
                  recoveringPrimary
                    ? (event) => setInternalPort(event.target.value)
                    : undefined
                }
              />
            </label>
            <label className="block space-y-1.5 text-[11px] font-medium">
              Public Port
              <Input
                aria-label="Public Port"
                className="font-mono"
                disabled={
                  allocation !== null || !canEditPublicPort || portLease.pending
                }
                max={65_535}
                min={1}
                readOnly={allocation !== null || !canEditPublicPort}
                type="number"
                value={
                  allocation
                    ? String(allocation.externalPort)
                    : portLease.portValue
                }
                onBlur={() => {
                  if (
                    recoveringPrimary &&
                    canEditPublicPort &&
                    portLease.lease
                  ) {
                    void portLease.commit().catch(() => undefined)
                  }
                }}
                onChange={(event) => portLease.setPortValue(event.target.value)}
              />
            </label>
            <label className="col-span-2 block space-y-1.5 text-[11px] font-medium sm:col-span-1">
              Protocol
              <ProtocolSelect
                disabled={allocation !== null}
                value={protocol}
                onChange={setProtocol}
              />
            </label>
          </div>

          {validationError || portLease.error || error ? (
            <p className="text-xs text-destructive">
              {validationError ?? portLease.error ?? error}
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose
              render={
                <Button disabled={pending} type="button" variant="outline" />
              }
            >
              Cancel
            </DialogClose>
            <Button disabled={pending || portPending} type="submit">
              {pending || portPending ? (
                <LoaderCircle className="animate-spin" />
              ) : null}
              {pending || portPending
                ? "Applying"
                : recoveringPrimary
                  ? "Assign Default Server"
                  : editing
                    ? "Save allocation"
                    : "Allocate port"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RouteStatusButton({
  state,
  canRestart,
  restarting,
  onRestart,
}: {
  state: RelayInstanceWebRouteState
  canRestart: boolean
  restarting: boolean
  onRestart: () => void
}) {
  if (state.status === "ready") return null
  const pending = state.status === "pending_restart"

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={
            pending
              ? restarting
                ? "Applying route changes"
                : "Restart to apply route changes"
              : "View route error"
          }
          className={
            pending
              ? "w-7 border-amber-400/30 bg-amber-400/5 px-0 text-amber-200 hover:bg-amber-400/10 hover:text-amber-100 sm:w-auto sm:px-3"
              : "w-7 px-0 sm:w-auto sm:px-3"
          }
          onClick={() => {
            showRouteStatusToast({
              canRestart,
              restarting,
              state,
              onRestart,
            })
          }}
          size="sm"
          type="button"
          variant={pending ? "outline" : "destructive"}
          aria-live="polite"
        >
          {pending ? (
            <RotateCw className={restarting ? "animate-spin" : undefined} />
          ) : (
            <CircleAlert />
          )}
          <span className="hidden sm:inline">
            {pending
              ? restarting
                ? "Applying"
                : "Restart to apply"
              : "Route error"}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{state.message}</TooltipContent>
    </Tooltip>
  )
}

function showRouteStatusToast({
  canRestart,
  restarting,
  state,
  onRestart,
}: {
  canRestart: boolean
  restarting: boolean
  state: RelayInstanceWebRouteState
  onRestart?: () => void
}) {
  const pending = state.status === "pending_restart"
  if (pending) {
    showPendingRestartToast({
      canRestart,
      message: state.message,
      restarting,
      onRestart,
    })
    return
  }
  showToast({
    description: state.message,
    message: "Edge route error",
    type: "error",
  })
}

function showPendingRestartToast({
  canRestart,
  message,
  restarting,
  onRestart,
}: {
  canRestart: boolean
  message: string
  restarting: boolean
  onRestart?: () => void
}) {
  showToast({
    description: message,
    duration: Infinity,
    message: "Restart required",
    type: "warning",
    ...(canRestart && !restarting && onRestart
      ? {
          action: {
            label: "Restart and apply",
            onClick: onRestart,
          },
        }
      : {}),
  })
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The network change failed."
}

function formatHostPort(host: string, port: number): string {
  return `${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const textarea = document.createElement("textarea")
    textarea.value = value
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    document.body.append(textarea)
    textarea.select()
    document.execCommand("copy")
    textarea.remove()
  }
}
