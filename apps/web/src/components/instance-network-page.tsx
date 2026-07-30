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
  Cable,
  Check,
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
          ? "Game server port saved"
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
          error={
            update.error || routeError
              ? errorMessage(update.error ?? routeError)
              : null
          }
          pending={update.isPending || routePending}
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
        allocation={dialog?.mode === "edit-port" ? dialog.allocation : null}
        error={update.error ? errorMessage(update.error) : null}
        open={
          dialog?.mode === "edit-port" || dialog?.mode === "recover-primary"
        }
        pending={update.isPending}
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
          Internal port
        </WorkspaceTableHeading>
        <WorkspaceTableHeading>Public address</WorkspaceTableHeading>
        <WorkspaceTableHeading className="w-[6.5rem] text-right">
          Actions
        </WorkspaceTableHeading>
      </WorkspaceTableHead>
      <tbody className="divide-y divide-border/70">
        <tr
          className={
            primaryPort
              ? "bg-primary/[0.04] hover:bg-primary/[0.065]"
              : pendingPrimaryPort
                ? "bg-amber-400/[0.035] hover:bg-amber-400/[0.055]"
                : "bg-destructive/[0.035] hover:bg-destructive/[0.055]"
          }
        >
          <WorkspaceTableCell>
            <div className="flex min-w-0 items-center gap-2.5">
              <RouteRowIcon
                canRestart={canRestart}
                errorMessage={
                  displayedPrimaryPort
                    ? undefined
                    : "Edit the game server port to assign its internal port and protocol."
                }
                kind="port"
                pendingMessage={
                  pendingPrimaryPort
                    ? "Restart this server when you are ready to apply its game server port."
                    : undefined
                }
                restarting={restarting}
                onRestart={onRestart}
              />
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-xs font-medium">
                    Game server port
                  </span>
                  <span className="shrink-0 border border-primary/25 bg-primary/8 px-1.5 py-0.5 font-mono text-[8px] leading-none tracking-[0.08em] text-primary uppercase">
                    Primary
                  </span>
                </div>
                <span className="mt-0.5 block font-mono text-[9px] text-muted-foreground uppercase">
                  {displayedPrimaryPort?.protocol ?? "Not configured"}
                </span>
              </div>
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
                      aria-label="Edit game server port"
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
                        ? "Edit pending game server port"
                        : "Assign game server port"}
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
  kind: "port" | "web"
  pendingMessage?: string
  restarting?: boolean
  state?: RelayInstanceWebRouteState
  onRestart?: () => void
}) {
  const pending =
    pendingMessage !== undefined || state?.status === "pending_restart"
  const blocked = state?.status === "blocked" || errorMessage !== undefined
  const Icon = kind === "web" ? Globe2 : Cable

  if (!pending && !blocked) {
    return (
      <div className="grid size-7 shrink-0 place-items-center border border-emerald-400/25 bg-emerald-400/5 text-emerald-300">
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
              ? "View game server port restart warning"
              : errorMessage
                ? "View game server port error"
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
                message: "Game server port is not configured",
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
            ? "Game server port needs configuration"
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

function AddNetworkRouteDialog({
  canAddPort,
  canAddWebRoute,
  error,
  pending,
  webRoute,
  onOpenChange,
  onSubmitPort,
  onSubmitWebRoute,
}: {
  canAddPort: boolean
  canAddWebRoute: boolean
  error: string | null
  pending: boolean
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
          <DialogDescription>
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
              const parsed = relayInstancePortInputSchema.safeParse({
                internalPort: Number(form.get("internalPort")),
                name: String(form.get("name") ?? ""),
                protocol: String(form.get("protocol") ?? "tcp"),
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
              <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
                <label className="block space-y-1.5 text-[11px] font-medium">
                  Internal port
                  <Input
                    max={65_535}
                    min={1}
                    name="internalPort"
                    placeholder="24454"
                    required
                    type="number"
                  />
                </label>
                <label className="block space-y-1.5 text-[11px] font-medium">
                  Protocol
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                    defaultValue="tcp"
                    name="protocol"
                  >
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                    <option value="both">TCP + UDP</option>
                  </select>
                </label>
              </div>
              <div className="border border-border/70 bg-background/45 px-3 py-2.5">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[10px] text-muted-foreground">
                    Public port
                  </span>
                  <span className="font-mono text-xs text-foreground">
                    Assigned after creation
                  </span>
                </div>
                <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground/75">
                  Public ports are selected by Kiln and cannot be changed.
                </p>
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
                  Internal port
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

          {validationError || error ? (
            <p className="text-xs text-destructive">
              {validationError ?? error}
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
            <Button disabled={pending} type="submit">
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : webRoute ? (
                <Pencil />
              ) : (
                <Plus />
              )}
              {pending
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
  error,
  open,
  pending,
  pendingPrimaryPort,
  recoveringPrimary = false,
  onOpenChange,
  onSubmit,
}: {
  allocation: RelayInstancePortAllocation | null
  error: string | null
  open: boolean
  pending: boolean
  pendingPrimaryPort: RelayInstancePendingPrimaryPort | null
  recoveringPrimary?: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (port: RelayInstancePortInput) => Promise<void>
}) {
  const [validationError, setValidationError] = React.useState<string | null>(
    null
  )
  const editing = allocation !== null || recoveringPrimary

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="font-mono text-[9px] tracking-[0.16em] text-primary uppercase">
            {recoveringPrimary
              ? "Game server port"
              : editing
                ? "Port mapping"
                : "New allocation"}
          </p>
          <DialogTitle>
            {recoveringPrimary
              ? "Assign the game server port"
              : editing
                ? "Edit port allocation"
                : "Allocate a port"}
          </DialogTitle>
          <DialogDescription>
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
            const parsed = relayInstancePortInputSchema.safeParse({
              id: allocation?.id ?? (recoveringPrimary ? "primary" : undefined),
              internalPort: Number(form.get("internalPort")),
              name: recoveringPrimary
                ? "Game server port"
                : String(form.get("name") ?? ""),
              protocol: String(form.get("protocol") ?? "tcp"),
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
          {recoveringPrimary ? null : (
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
          <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
            <label className="block space-y-1.5 text-[11px] font-medium">
              Internal port
              <Input
                defaultValue={
                  allocation?.internalPort ??
                  pendingPrimaryPort?.internalPort ??
                  (recoveringPrimary ? 25_565 : undefined)
                }
                max={65_535}
                min={1}
                name="internalPort"
                placeholder="24454"
                required
                type="number"
              />
            </label>
            <label className="block space-y-1.5 text-[11px] font-medium">
              Protocol
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-55"
                defaultValue={
                  allocation?.protocol ?? pendingPrimaryPort?.protocol ?? "tcp"
                }
                disabled={allocation !== null}
                name="protocol"
              >
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="both">TCP + UDP</option>
              </select>
              {allocation ? (
                <input
                  name="protocol"
                  type="hidden"
                  value={allocation.protocol}
                />
              ) : null}
            </label>
          </div>

          <div className="border border-border/70 bg-background/45 px-3 py-2.5">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[10px] text-muted-foreground">
                Public port
              </span>
              <span className="font-mono text-xs text-foreground">
                {allocation?.externalPort ??
                  (pendingPrimaryPort
                    ? "Assigned on restart"
                    : "Assigned after creation")}
              </span>
            </div>
            <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground/75">
              Public ports are selected by Kiln and cannot be changed.
            </p>
          </div>

          {validationError || error ? (
            <p className="text-xs text-destructive">
              {validationError ?? error}
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
            <Button disabled={pending} type="submit">
              {pending ? <LoaderCircle className="animate-spin" /> : null}
              {pending
                ? "Applying"
                : recoveringPrimary
                  ? "Assign game port"
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
