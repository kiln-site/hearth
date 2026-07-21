import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouterState } from "@tanstack/react-router"
import {
  Check,
  CircleStop,
  Copy,
  EllipsisVertical,
  LoaderCircle,
  OctagonX,
  Play,
  RotateCw,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import { ToolbarSidebarTrigger } from "@/components/global-page-toolbar"
import {
  queryKeys,
  relaySnapshotQueryOptions,
  replaceRelaySnapshotInstance,
} from "@/lib/query-options"
import type { RelayFleetSnapshot } from "@/lib/relay-fleet"
import {
  selectInstanceObservedState,
  selectInstanceRelayConnected,
  selectInstanceRuntime,
} from "@/lib/relay-selectors"
import type {
  InstanceRuntime,
  InstanceWorkspaceInstance,
} from "@/lib/relay-selectors"
import { performRelayAction } from "@/server/relay"

const ResourceHistoryChart = React.lazy(async () => {
  const module = await import("@/components/resource-history-chart")
  return { default: module.ResourceHistoryChart }
})
const localTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "long",
})

function clampResourcePercent(value: number | null | undefined): number {
  return value === null || value === undefined
    ? 0
    : Math.max(1, Math.min(value, 100))
}

export interface InstanceWorkspacePermissions {
  consoleWrite: boolean
  filesWrite: boolean
  power: boolean
  settings: boolean
  shareLogs: boolean
}

export interface FileTreePreferences {
  collapsed: boolean
  width: number | null
}

const InstanceIdentityContext =
  React.createContext<InstanceWorkspaceInstance | null>(null)
const InstancePermissionsContext =
  React.createContext<InstanceWorkspacePermissions | null>(null)
const FileTreePreferencesContext =
  React.createContext<FileTreePreferences | null>(null)
const InstanceRelayConnectedContext = React.createContext<boolean | null>(null)

function useRequiredContext<T>(
  context: React.Context<T | null>,
  hookName: string
): T {
  const value = React.useContext(context)
  if (value === null) {
    throw new Error(`${hookName} must be used within InstanceWorkspace`)
  }
  return value
}

export function useInstanceIdentity() {
  return useRequiredContext(InstanceIdentityContext, "useInstanceIdentity")
}

export function useInstancePermissions() {
  return useRequiredContext(
    InstancePermissionsContext,
    "useInstancePermissions"
  )
}

export function useFileTreePreferences() {
  return useRequiredContext(
    FileTreePreferencesContext,
    "useFileTreePreferences"
  )
}

export function useInstanceRelayConnected() {
  return useRequiredContext(
    InstanceRelayConnectedContext,
    "useInstanceRelayConnected"
  )
}

export function InstanceWorkspace({
  children,
  instance,
  fileTreePreferences,
  permissions,
}: {
  children: React.ReactNode
  instance: InstanceWorkspaceInstance
  fileTreePreferences: FileTreePreferences
  permissions: InstanceWorkspacePermissions
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <InstanceWorkspaceHeader
        instance={instance}
        canControlPower={permissions.power}
      />

      <div
        data-slot="instance-workspace-surface"
        className="relative mx-2 mt-2 flex min-h-0 flex-1 overflow-hidden border border-border/80 bg-card/30 [contain:paint]"
      >
        <InstanceIdentityContext.Provider value={instance}>
          <InstancePermissionsContext.Provider value={permissions}>
            <FileTreePreferencesContext.Provider value={fileTreePreferences}>
              <InstanceRelayConnectionBoundary instance={instance}>
                {children}
              </InstanceRelayConnectionBoundary>
            </FileTreePreferencesContext.Provider>
          </InstancePermissionsContext.Provider>
        </InstanceIdentityContext.Provider>
      </div>
    </div>
  )
}

function InstanceRelayConnectionBoundary({
  children,
  instance,
}: {
  children: React.ReactNode
  instance: InstanceWorkspaceInstance
}) {
  const selectRelayConnected = React.useMemo(
    () => selectInstanceRelayConnected(instance.id),
    [instance.id]
  )
  const { data: relayConnected = false } = useQuery({
    ...relaySnapshotQueryOptions(),
    select: selectRelayConnected,
  })

  return (
    <InstanceRelayConnectedContext.Provider value={relayConnected}>
      {children}
    </InstanceRelayConnectedContext.Provider>
  )
}

type ServerAction = "start" | "stop" | "restart" | "kill"

function InstanceWorkspaceHeader({
  instance,
  canControlPower,
}: {
  instance: InstanceWorkspaceInstance
  canControlPower: boolean
}) {
  const [error, setError] = React.useState<string | null>(null)

  return (
    <header className="shrink-0 border-b bg-background/90 backdrop-blur-xl">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 px-3 py-3 sm:px-5 lg:min-h-20 lg:py-2 xl:grid-cols-[minmax(0,1fr)_39rem_auto] xl:gap-x-5">
        <InstanceIdentity error={error} instance={instance} />
        <LiveResourceMeters
          instanceId={instance.id}
          relayId={instance.relayId}
        />
        <InstancePowerControls
          canControlPower={canControlPower}
          instance={instance}
          onError={setError}
        />
      </div>
    </header>
  )
}

function InstanceIdentity({
  error,
  instance,
}: {
  error: string | null
  instance: InstanceWorkspaceInstance
}) {
  const [idCopied, setIdCopied] = React.useState(false)
  const [addressCopied, setAddressCopied] = React.useState(false)
  const addressCopyTimer = React.useRef<number | null>(null)
  const idCopyTimer = React.useRef<number | null>(null)

  React.useEffect(
    () => () => {
      if (addressCopyTimer.current) {
        window.clearTimeout(addressCopyTimer.current)
      }
      if (idCopyTimer.current) window.clearTimeout(idCopyTimer.current)
    },
    []
  )

  async function copyAddress() {
    await copyToClipboard(instance.connectAddress)
    setAddressCopied(true)
    if (addressCopyTimer.current) window.clearTimeout(addressCopyTimer.current)
    addressCopyTimer.current = window.setTimeout(
      () => setAddressCopied(false),
      1_800
    )
  }

  async function copyId() {
    await copyToClipboard(instance.id)
    setIdCopied(true)
    if (idCopyTimer.current) window.clearTimeout(idCopyTimer.current)
    idCopyTimer.current = window.setTimeout(() => setIdCopied(false), 1_800)
  }

  return (
    <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
      <ToolbarSidebarTrigger />
      <span className="h-6 w-px shrink-0 bg-border/80" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h1
          className="flex min-w-0 items-baseline gap-1.5 font-heading tracking-[-0.03em]"
          title={instance.name}
        >
          <span className="min-w-0 truncate text-lg font-semibold text-foreground sm:text-xl">
            {instance.name}
          </span>
          <span className="shrink-0 text-border">/</span>
          <span className="shrink-0 text-sm font-medium text-muted-foreground sm:text-base">
            <InstanceRouteTitle />
          </span>
        </h1>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-[10px] whitespace-nowrap text-muted-foreground sm:text-xs">
          <span className="shrink-0">
            {instance.implementation} {instance.version}
          </span>
          <span className="text-border">/</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={`truncate font-mono transition-colors ${idCopied ? "text-emerald-400" : "hover:text-foreground"}`}
                aria-label={`Copy full server ID ${instance.id}`}
                onClick={copyId}
              >
                {instance.shortId}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {idCopied ? "Full server ID copied" : "Copy full server ID"}
            </TooltipContent>
          </Tooltip>
          <span className="hidden text-border xl:inline">/</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={`hidden min-w-0 items-center gap-1 truncate font-mono transition-colors xl:inline-flex ${addressCopied ? "text-emerald-400" : "text-primary/75 hover:text-primary"}`}
                aria-label={`Copy server address ${instance.connectAddress}`}
                onClick={copyAddress}
              >
                <span className="truncate">{instance.connectAddress}</span>
                {addressCopied ? (
                  <Check className="size-3 shrink-0" />
                ) : (
                  <Copy className="size-3 shrink-0 opacity-55" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {addressCopied ? "Address copied" : "Copy server address"}
            </TooltipContent>
          </Tooltip>
        </div>
        {error ? (
          <p className="mt-0.5 truncate text-[9px] text-destructive">{error}</p>
        ) : null}
      </div>
    </div>
  )
}

function InstanceRouteTitle() {
  const title = useRouterState({
    select: (state) => {
      const pathname = state.location.pathname
      if (/\/files(?:\/|$)/.test(pathname)) return "Files"
      if (pathname.endsWith("/info")) return "Info"
      return "Console"
    },
  })
  return <>{title}</>
}

function ServerPowerControls({
  action,
  canControlPower,
  instance,
  onAction,
  relayConnected,
}: {
  action: ServerAction | null
  canControlPower: boolean
  instance: Pick<InstanceWorkspaceInstance, "id" | "name"> &
    Pick<InstanceRuntime, "observedState">
  onAction: (action: ServerAction) => Promise<void>
  relayConnected: boolean
}) {
  const [serverActionsOpen, setServerActionsOpen] = React.useState(false)
  const [confirmKill, setConfirmKill] = React.useState(false)
  if (!canControlPower) return null

  const isRunning = instance.observedState === "running"
  const isStarting = instance.observedState === "starting"
  const isStopping = instance.observedState === "stopping"
  const powerIsOn = isRunning || isStarting
  const startUnavailable =
    !relayConnected || powerIsOn || isStopping || action !== null
  const stopUnavailable =
    !relayConnected || !powerIsOn || isStopping || action !== null

  function runAction(nextAction: ServerAction) {
    setServerActionsOpen(false)
    setConfirmKill(false)
    void onAction(nextAction)
  }

  return (
    <div className="col-start-2 row-start-1 flex items-center justify-end gap-1.5 xl:col-start-3">
      <Button
        variant="outline"
        size="sm"
        className={
          powerIsOn
            ? "hidden h-9 gap-1.5 !border-red-500/65 !bg-red-600 px-3 text-xs !text-white shadow-none hover:!border-red-400 hover:!bg-red-500 disabled:!border-red-500/35 disabled:!bg-red-600/45 disabled:!text-white/70 md:inline-flex"
            : "hidden h-9 gap-1.5 !border-blue-500/65 !bg-blue-600 px-3 text-xs !text-white shadow-none hover:!border-blue-400 hover:!bg-blue-500 md:inline-flex"
        }
        disabled={!relayConnected || action !== null || isStopping}
        onClick={() => runAction(powerIsOn ? "stop" : "start")}
      >
        {action === "start" || action === "stop" || isStopping ? (
          <LoaderCircle className="animate-spin" />
        ) : powerIsOn ? (
          <CircleStop />
        ) : (
          <Play />
        )}
        {action === "start"
          ? "Starting"
          : action === "stop" || isStopping
            ? "Stopping"
            : powerIsOn
              ? "Stop"
              : "Start"}
      </Button>
      <Popover
        open={serverActionsOpen}
        onOpenChange={(open) => {
          setServerActionsOpen(open)
          if (!open) setConfirmKill(false)
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="icon-lg"
                className="bg-card shadow-none"
                aria-label="Server actions"
                disabled={!relayConnected || action !== null}
              >
                {action !== null ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <EllipsisVertical />
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            Power Options
          </TooltipContent>
        </Tooltip>
        <PopoverContent
          align="end"
          sideOffset={7}
          className="w-[min(17rem,calc(100vw-1.5rem))] p-0"
        >
          {confirmKill ? (
            <>
              <div className="border-b px-3 py-2.5">
                <p className="text-xs font-semibold text-foreground">
                  Kill {instance.name}?
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  This immediately terminates the container. Unsaved world data
                  may be lost.
                </p>
              </div>
              <div className="flex justify-end gap-1.5 p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmKill(false)}
                >
                  Back
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="!border-red-500/65 !bg-red-600 !text-white hover:!border-red-400 hover:!bg-red-500"
                  onClick={() => runAction("kill")}
                >
                  <OctagonX />
                  Kill now
                </Button>
              </div>
            </>
          ) : (
            <div className="p-1">
              <p className="border-b px-2 py-2 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Server actions
              </p>
              <PowerActionButton
                description="Power on the server"
                disabled={startUnavailable}
                icon={<Play className="size-3.5" />}
                label="Start"
                tone="start"
                onClick={() => runAction("start")}
              />
              <PowerActionButton
                description="Gracefully shut down"
                disabled={stopUnavailable}
                icon={<CircleStop className="size-3.5" />}
                label="Stop"
                tone="stop"
                onClick={() => runAction("stop")}
              />
              <PowerActionButton
                description="Gracefully stop and start"
                disabled={!relayConnected || !isRunning}
                icon={<RotateCw className="size-3.5" />}
                label="Restart"
                onClick={() => runAction("restart")}
              />
              <PowerActionButton
                description="Terminate immediately"
                disabled={!relayConnected || !powerIsOn || isStopping}
                icon={<OctagonX className="size-3.5" />}
                label="Kill"
                tone="kill"
                onClick={() => setConfirmKill(true)}
              />
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}

function InstancePowerControls({
  canControlPower,
  instance,
  onError,
}: {
  canControlPower: boolean
  instance: InstanceWorkspaceInstance
  onError: (error: string | null) => void
}) {
  const queryClient = useQueryClient()
  const selectObservedState = React.useMemo(
    () => selectInstanceObservedState(instance.id, instance.relayId),
    [instance.id, instance.relayId]
  )
  const { data: observedState } = useQuery({
    ...relaySnapshotQueryOptions(),
    select: selectObservedState,
  })
  const selectRelayConnected = React.useMemo(
    () => selectInstanceRelayConnected(instance.id),
    [instance.id]
  )
  const { data: relayConnected = false } = useQuery({
    ...relaySnapshotQueryOptions(),
    select: selectRelayConnected,
  })
  const relayActionMutation = useMutation({
    mutationFn: performRelayAction,
    onSuccess: (updated) => {
      queryClient.setQueryData<RelayFleetSnapshot>(
        queryKeys.relay.snapshot,
        (snapshot) => replaceRelaySnapshotInstance(snapshot, updated)
      )
    },
  })
  const mutateRelayAction = relayActionMutation.mutateAsync
  const [action, setAction] = React.useState<ServerAction | null>(null)

  const handleAction = React.useCallback(
    async (nextAction: ServerAction) => {
      if (!relayConnected) return
      setAction(nextAction)
      onError(null)
      try {
        await mutateRelayAction({
          data: {
            instanceId: instance.id,
            relayId: instance.relayId,
            action: nextAction,
          },
        })
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : "Relay action failed")
      } finally {
        setAction(null)
      }
    },
    [instance.id, instance.relayId, mutateRelayAction, onError, relayConnected]
  )

  if (!observedState) {
    if (!canControlPower) return null
    return (
      <div
        className="col-start-2 row-start-1 flex items-center justify-end gap-1.5 xl:col-start-3"
        aria-label="Loading server power controls"
      >
        <span className="hidden h-9 w-[4.75rem] animate-pulse bg-muted/35 md:block" />
        <span className="size-10 animate-pulse bg-muted/35" />
      </div>
    )
  }
  return (
    <ServerPowerControls
      action={action}
      canControlPower={canControlPower}
      instance={{ id: instance.id, name: instance.name, observedState }}
      onAction={handleAction}
      relayConnected={relayConnected}
    />
  )
}

function PowerActionButton({
  description,
  disabled,
  icon,
  label,
  onClick,
  tone = "default",
}: {
  description: string
  disabled: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
  tone?: "default" | "start" | "stop" | "kill"
}) {
  const toneClassName = {
    default: "text-foreground hover:bg-popover-accent/80",
    start: disabled
      ? "text-muted-foreground/35"
      : "text-blue-300 hover:bg-blue-500/10",
    stop: disabled
      ? "text-muted-foreground/35"
      : "text-red-400 hover:bg-red-500/10",
    kill: "text-red-400 hover:bg-red-500/10",
  }[tone]
  const iconClassName = {
    default: "border-border bg-card text-muted-foreground",
    start: disabled
      ? "border-border/55 bg-muted/15"
      : "border-blue-500/25 bg-blue-500/5",
    stop: disabled
      ? "border-border/55 bg-muted/15"
      : "border-red-500/25 bg-red-500/5",
    kill: "border-red-500/25 bg-red-500/5",
  }[tone]
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2.5 px-2 py-2 text-left text-xs transition-colors focus-visible:bg-popover-accent focus-visible:outline-none disabled:cursor-default disabled:opacity-35 ${toneClassName}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span
        className={`grid size-7 place-items-center border ${iconClassName}`}
      >
        {icon}
      </span>
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-[10px] text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  )
}

const RESOURCE_STYLES = {
  cpu: {
    indicator: "bg-sky-400/85",
    value: "text-sky-300/95",
    chart: "oklch(0.74 0.13 235)",
  },
  memory: {
    indicator: "bg-violet-400/85",
    value: "text-violet-300/95",
    chart: "oklch(0.7 0.15 292)",
  },
  storage: {
    indicator: "bg-emerald-400/80",
    value: "text-emerald-300/95",
    chart: "oklch(0.72 0.13 160)",
  },
  network: {
    indicator: "bg-cyan-300/85",
    value: "text-cyan-200/95",
    chart: "oklch(0.78 0.11 205)",
  },
} as const

type ResourceId = keyof typeof RESOURCE_STYLES
const RESOURCE_IDS: Array<ResourceId> = ["cpu", "memory", "storage", "network"]

interface ResourceHistoryStore {
  getSnapshot: () => Array<ResourceHistoryPoint>
  record: (instance: InstanceRuntime) => void
  subscribe: (listener: () => void) => () => void
}

function createResourceHistoryStore(
  instanceId: string,
  relayId: string
): ResourceHistoryStore {
  let currentInstanceId = instanceId
  let currentRelayId = relayId
  let points: Array<ResourceHistoryPoint> = []
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => points,
    record: (instance) => {
      let cleared = false
      if (
        currentInstanceId !== instance.id ||
        currentRelayId !== instance.relayId
      ) {
        currentInstanceId = instance.id
        currentRelayId = instance.relayId
        points = []
        cleared = true
      }
      const resources = instance.resources
      if (!resources) {
        if (cleared) for (const listener of listeners) listener()
        return
      }
      const timestamp = Date.parse(resources.sampledAt)
      if (
        !Number.isFinite(timestamp) ||
        points.at(-1)?.timestamp === timestamp
      ) {
        if (cleared) for (const listener of listeners) listener()
        return
      }
      const point: ResourceHistoryPoint = {
        timestamp,
        cpu: resources.cpu.percent,
        memory: resources.memory.percent,
        storage: resources.storage.percent,
        network: resources.network
          ? resources.network.receivedBytesPerSecond +
            resources.network.sentBytesPerSecond
          : null,
        networkReceived: resources.network?.receivedBytesPerSecond ?? null,
        networkSent: resources.network?.sentBytesPerSecond ?? null,
      }
      points = [...points, point].filter(
        (sample) => timestamp - sample.timestamp <= 60_000
      )
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function LiveResourceMeters({
  instanceId,
  relayId,
}: {
  instanceId: string
  relayId: string
}) {
  const [historyStore] = React.useState(() =>
    createResourceHistoryStore(instanceId, relayId)
  )

  return (
    <div
      className="hidden min-w-0 md:col-span-2 md:block xl:col-span-1 xl:col-start-2 xl:row-start-1"
      aria-label="Server resource usage"
    >
      <ResourceHistoryRecorder
        instanceId={instanceId}
        relayId={relayId}
        store={historyStore}
      />
      <div className="grid h-14 min-w-0 grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.25fr)_5.5rem] divide-x divide-border/60 border border-border/80 bg-card/40 px-1.5 py-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.15fr)_5.75rem]">
        {RESOURCE_IDS.map((resourceId) => (
          <LiveResourceMeter
            key={resourceId}
            instanceId={instanceId}
            relayId={relayId}
            resourceId={resourceId}
            historyStore={historyStore}
          />
        ))}
        <InstanceUptimeMeter instanceId={instanceId} relayId={relayId} />
      </div>
    </div>
  )
}

function ResourceHistoryRecorder({
  instanceId,
  relayId,
  store,
}: {
  instanceId: string
  relayId: string
  store: ResourceHistoryStore
}) {
  const selectRuntime = React.useMemo(
    () => selectInstanceRuntime(instanceId, relayId),
    [instanceId, relayId]
  )
  const { data: instance } = useQuery({
    ...relaySnapshotQueryOptions(),
    select: selectRuntime,
  })

  React.useEffect(() => {
    if (instance) store.record(instance)
  }, [instance, store])

  return null
}

function LiveResourceMeter({
  instanceId,
  relayId,
  resourceId,
  historyStore,
}: {
  instanceId: string
  relayId: string
  resourceId: ResourceId
  historyStore: ResourceHistoryStore
}) {
  const selectResource = React.useMemo(
    () => (snapshot: RelayFleetSnapshot) => {
      const instance = snapshot.instances.find(
        (item) => item.id === instanceId && item.relayId === relayId
      )
      return instance ? resourceItem(instance, resourceId) : null
    },
    [instanceId, relayId, resourceId]
  )
  const { data: resource } = useQuery({
    ...relaySnapshotQueryOptions(),
    select: selectResource,
  })
  if (!resource) return null

  return (
    <ResourceHistoryPopover resource={resource} historyStore={historyStore}>
      <button
        type="button"
        className={`group min-w-0 text-left outline-none first:pl-1.5 focus-visible:bg-muted/25 ${resource.id === "network" ? "px-1.5" : "px-2.5"}`}
      >
        <div className="flex items-center justify-between gap-1.5 font-mono text-[11px] leading-none tracking-[0.065em] xl:text-xs">
          <span className="shrink-0 font-medium text-muted-foreground/85 transition-colors group-hover:text-foreground/85">
            {resource.label}
          </span>
          {resource.id === "network" ? (
            <span className="flex min-w-0 items-center gap-1 font-medium tracking-[-0.045em] tabular-nums xl:gap-1.5">
              <span className="truncate text-cyan-200/95">
                ↓ {resource.receivedDisplayValue}
              </span>
              <span className="truncate text-primary/90">
                ↑ {resource.sentDisplayValue}
              </span>
            </span>
          ) : (
            <span
              className={`truncate font-medium tabular-nums ${resource.valueClassName}`}
            >
              {resource.displayValue}
            </span>
          )}
        </div>
        <ResourceBar resource={resource} className="mt-3" />
      </button>
    </ResourceHistoryPopover>
  )
}

function InstanceUptimeMeter({
  instanceId,
  relayId,
}: {
  instanceId: string
  relayId: string
}) {
  const selectRuntime = React.useMemo(
    () => (snapshot: RelayFleetSnapshot) => {
      const instance = snapshot.instances.find(
        (item) => item.id === instanceId && item.relayId === relayId
      )
      return instance
        ? {
            id: instance.id,
            observedState: instance.observedState,
            relayId: instance.relayId,
            resources: null,
            startedAt: instance.startedAt,
          }
        : null
    },
    [instanceId, relayId]
  )
  const { data: instance } = useQuery({
    ...relaySnapshotQueryOptions(),
    select: selectRuntime,
  })
  const uptime = useInstanceUptime(instance)
  const startedAt = useBrowserLocalTimestamp(instance?.startedAt ?? null)

  return (
    <HoverCard openDelay={160} closeDelay={100}>
      <HoverCardTrigger asChild>
        <div
          className="min-w-0 px-1.5 font-mono text-[11px] leading-none outline-none focus-visible:bg-muted/25 xl:px-2 xl:text-xs"
          aria-label={`Instance uptime ${uptime ?? "unavailable"}`}
          tabIndex={startedAt ? 0 : undefined}
        >
          <span className="block font-medium tracking-[0.065em] text-muted-foreground/85">
            UPTIME
          </span>
          <div className="mt-2.5 flex h-2 items-center justify-center">
            <span className="font-medium tracking-[-0.045em] whitespace-nowrap text-foreground/85 tabular-nums xl:text-[13px]">
              {uptime ?? "—"}
            </span>
          </div>
        </div>
      </HoverCardTrigger>
      {startedAt ? (
        <HoverCardContent
          align="end"
          side="bottom"
          sideOffset={8}
          collisionPadding={12}
          className="w-max max-w-[calc(100vw-1.5rem)] rounded-none border-border/90 bg-popover px-3 py-2 shadow-xl"
        >
          <div className="text-left">
            <p className="font-mono text-[8px] font-medium tracking-[0.1em] text-muted-foreground/70 uppercase">
              Started on
            </p>
            <time
              dateTime={instance?.startedAt ?? undefined}
              className="mt-1 block font-mono text-xs whitespace-nowrap text-foreground/85"
            >
              {startedAt}
            </time>
          </div>
        </HoverCardContent>
      ) : null}
    </HoverCard>
  )
}

interface ResourceItem {
  id: "cpu" | "memory" | "storage" | "network"
  label: string
  value: number | null
  displayValue: string
  receivedDisplayValue?: string
  sentDisplayValue?: string
  receivedValue?: number | null
  sentValue?: number | null
  detail: string
  historyDetail?: string
  indicatorClassName: string
  valueClassName: string
  chartColor: string
}

function useInstanceUptime(
  instance: InstanceRuntime | null | undefined
): string | null {
  const [now, setNow] = React.useState<number | null>(null)
  const startedAt = instance?.startedAt ? Date.parse(instance.startedAt) : NaN
  const running = instance?.observedState === "running"

  React.useEffect(() => {
    setNow(Date.now())
    if (!running || !Number.isFinite(startedAt)) return

    const interval = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(interval)
  }, [instance?.id, running, startedAt])

  if (!running || !Number.isFinite(startedAt) || now === null) return null
  return formatUptime(Math.max(0, Math.floor((now - startedAt) / 1_000)))
}

function useBrowserLocalTimestamp(value: string | null): string | null {
  return React.useSyncExternalStore(
    subscribeToBrowserLocale,
    () => formatBrowserLocalTimestamp(value),
    () => null
  )
}

function subscribeToBrowserLocale(): () => void {
  // Locale has no browser change event; this store only defers formatting until hydration.
  return () => undefined
}

function formatBrowserLocalTimestamp(value: string | null): string | null {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp)
    ? localTimestampFormatter.format(new Date(timestamp))
    : null
}

function resourceItem(instance: InstanceRuntime, id: ResourceId): ResourceItem {
  const resources = instance.resources
  const unavailable =
    instance.observedState === "running" ? "Sampling" : "Offline"

  if (id === "cpu") {
    return {
      id: "cpu",
      label: "CPU",
      value: resources?.cpu.percent ?? null,
      displayValue: formatPercent(resources?.cpu.percent),
      detail: resources
        ? `${formatPercent(resources.cpu.percent)} container CPU`
        : unavailable,
      indicatorClassName: RESOURCE_STYLES.cpu.indicator,
      valueClassName: RESOURCE_STYLES.cpu.value,
      chartColor: RESOURCE_STYLES.cpu.chart,
    }
  }
  if (id === "memory") {
    return {
      id: "memory",
      label: "RAM",
      value: resources?.memory.percent ?? null,
      displayValue: formatPercent(resources?.memory.percent),
      detail: resources
        ? `${formatBytes(resources.memory.usedBytes)} of ${formatBytes(resources.memory.totalBytes)}`
        : unavailable,
      indicatorClassName: RESOURCE_STYLES.memory.indicator,
      valueClassName: RESOURCE_STYLES.memory.value,
      chartColor: RESOURCE_STYLES.memory.chart,
    }
  }
  if (id === "storage") {
    return {
      id: "storage",
      label: "DISK",
      value: resources?.storage.percent ?? null,
      displayValue: formatPercent(resources?.storage.percent),
      detail: resources
        ? `${formatBytes(resources.storage.usedBytes)} of ${formatBytes(resources.storage.totalBytes)} on the instance volume`
        : unavailable,
      indicatorClassName: RESOURCE_STYLES.storage.indicator,
      valueClassName: RESOURCE_STYLES.storage.value,
      chartColor: RESOURCE_STYLES.storage.chart,
    }
  }
  return {
    id: "network",
    label: "NET",
    value: resources?.network
      ? networkActivityPercent(
          resources.network.receivedBytesPerSecond +
            resources.network.sentBytesPerSecond
        )
      : null,
    displayValue: resources?.network
      ? `${formatBytesPerSecond(
          resources.network.receivedBytesPerSecond +
            resources.network.sentBytesPerSecond
        )}`
      : "—",
    receivedDisplayValue: resources?.network
      ? formatCompactBytesPerSecond(resources.network.receivedBytesPerSecond)
      : "—",
    sentDisplayValue: resources?.network
      ? formatCompactBytesPerSecond(resources.network.sentBytesPerSecond)
      : "—",
    receivedValue: resources?.network
      ? networkActivityPercent(resources.network.receivedBytesPerSecond)
      : null,
    sentValue: resources?.network
      ? networkActivityPercent(resources.network.sentBytesPerSecond)
      : null,
    detail: resources?.network
      ? `↓ ${formatBytesPerSecond(resources.network.receivedBytesPerSecond)} · ↑ ${formatBytesPerSecond(resources.network.sentBytesPerSecond)} · ${formatBytes(resources.network.receivedBytes + resources.network.sentBytes)} total`
      : unavailable,
    historyDetail: resources?.network
      ? `${formatBytes(resources.network.receivedBytes + resources.network.sentBytes)} transferred`
      : unavailable,
    indicatorClassName: RESOURCE_STYLES.network.indicator,
    valueClassName: RESOURCE_STYLES.network.value,
    chartColor: RESOURCE_STYLES.network.chart,
  }
}

function ResourceBar({
  resource,
  className = "",
}: {
  resource: ResourceItem
  className?: string
}) {
  return (
    <div
      className={`h-2 ${resource.id === "network" ? "grid grid-rows-2 gap-px" : "overflow-hidden bg-muted/55"} ${className}`}
      role="progressbar"
      aria-label={`${resource.label} usage`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={
        resource.value === null ? undefined : Math.min(resource.value, 100)
      }
      aria-valuetext={
        resource.id === "network" || resource.value === null
          ? resource.detail
          : resource.displayValue
      }
    >
      {resource.id === "network" ? (
        <>
          <div className="overflow-hidden bg-muted/55">
            <div
              className="h-full bg-cyan-300/85 transition-[width] duration-500 ease-out"
              style={{
                width: `${clampResourcePercent(resource.receivedValue)}%`,
              }}
            />
          </div>
          <div className="overflow-hidden bg-muted/55">
            <div
              className="h-full bg-primary/75 transition-[width] duration-500 ease-out"
              style={{ width: `${clampResourcePercent(resource.sentValue)}%` }}
            />
          </div>
        </>
      ) : (
        <div
          className={`h-full transition-[width] duration-500 ease-out ${resource.indicatorClassName}`}
          style={{ width: `${clampResourcePercent(resource.value)}%` }}
        />
      )}
    </div>
  )
}

interface ResourceHistoryPoint {
  timestamp: number
  cpu: number | null
  memory: number | null
  storage: number | null
  network: number | null
  networkReceived: number | null
  networkSent: number | null
}

function ResourceHistoryPopover({
  resource,
  historyStore,
  children,
}: {
  resource: ResourceItem
  historyStore: ResourceHistoryStore
  children: React.ReactElement
}) {
  return (
    <HoverCard openDelay={160} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        align="center"
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        className="w-[min(20rem,calc(100vw-1.5rem))] border-border/90 bg-popover p-0 shadow-2xl"
      >
        <ResourceHistoryCard resource={resource} historyStore={historyStore} />
      </HoverCardContent>
    </HoverCard>
  )
}

function ResourceHistoryCard({
  resource,
  historyStore,
}: {
  resource: ResourceItem
  historyStore: ResourceHistoryStore
}) {
  const history = React.useSyncExternalStore(
    historyStore.subscribe,
    historyStore.getSnapshot,
    historyStore.getSnapshot
  )
  const now = Date.now()
  const domainStart = now - 60_000
  const visibleHistory = history.filter(
    (sample) => sample.timestamp >= domainStart
  )
  const values = visibleHistory
    .map((sample) => sample[resource.id])
    .filter((value): value is number => value !== null)
  const average = values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null
  const peak = values.length ? Math.max(...values) : null
  const latest = visibleHistory.at(-1)
  const receivedStats = historyStatistics(
    visibleHistory.map((sample) => sample.networkReceived)
  )
  const sentStats = historyStatistics(
    visibleHistory.map((sample) => sample.networkSent)
  )
  const chartData = visibleHistory.map((sample) => ({
    timestamp: sample.timestamp,
    value: sample[resource.id],
    received: sample.networkReceived,
    sent: sample.networkSent,
  }))

  return (
    <div className="overflow-hidden rounded-[inherit]">
      <ResourceHistoryHeader
        resource={resource}
        average={average}
        peak={peak}
        networkReceived={latest?.networkReceived ?? null}
        networkSent={latest?.networkSent ?? null}
        receivedStats={receivedStats}
        sentStats={sentStats}
      />

      <div className="px-2.5 pt-2.5">
        <React.Suspense
          fallback={
            <div className="grid h-32 place-items-center border-y border-border/40 font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
              Loading history
            </div>
          }
        >
          <ResourceHistoryChart
            data={chartData}
            resourceId={resource.id}
            label={resource.label}
            color={resource.chartColor}
            domainStart={domainStart}
            domainEnd={now}
            formatValue={(value) => formatHistoryValue(resource.id, value)}
          />
        </React.Suspense>
      </div>
    </div>
  )
}

function ResourceHistoryHeader({
  resource,
  average,
  peak,
  networkReceived,
  networkSent,
  receivedStats,
  sentStats,
}: {
  resource: ResourceItem
  average: number | null
  peak: number | null
  networkReceived: number | null
  networkSent: number | null
  receivedStats: ReturnType<typeof historyStatistics>
  sentStats: ReturnType<typeof historyStatistics>
}) {
  return (
    <div className="h-[61px] border-b border-border/70 bg-muted/[0.08]">
      <div className="flex h-6 items-center justify-between border-b border-border/45 px-3">
        <span className="font-mono text-[11px] font-semibold tracking-[0.1em] text-foreground/85 uppercase">
          {resource.label}
        </span>
        <span className="font-mono text-[9px] tracking-[0.08em] text-muted-foreground/70">
          60s window
        </span>
      </div>

      {resource.id === "network" ? (
        <div className="grid h-9 grid-cols-2 divide-x divide-border/55">
          <NetworkHistoryValue
            direction="down"
            value={networkReceived}
            average={receivedStats.average}
            peak={receivedStats.peak}
          />
          <NetworkHistoryValue
            direction="up"
            value={networkSent}
            average={sentStats.average}
            peak={sentStats.peak}
          />
        </div>
      ) : (
        <div className="grid h-9 grid-cols-[1fr_4.5rem_4.5rem] divide-x divide-border/55">
          <div className="flex min-w-0 items-center gap-2 px-3">
            <span
              className={`truncate font-mono text-xl font-semibold tracking-[-0.04em] tabular-nums ${resource.valueClassName}`}
            >
              {resource.displayValue}
            </span>
            <span className="font-mono text-[9px] tracking-[0.06em] text-muted-foreground/60 uppercase">
              Now
            </span>
          </div>
          <HistoryStat
            label="Avg"
            value={
              average === null ? "—" : formatHistoryValue(resource.id, average)
            }
          />
          <HistoryStat
            label="Peak"
            value={peak === null ? "—" : formatHistoryValue(resource.id, peak)}
          />
        </div>
      )}
    </div>
  )
}

function HistoryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-center px-2 text-right">
      <span className="font-mono text-[9px] leading-none tracking-[0.06em] text-muted-foreground/65 uppercase">
        {label}
      </span>
      <span className="mt-1 truncate font-mono text-xs leading-none font-medium text-foreground/85 tabular-nums">
        {value}
      </span>
    </div>
  )
}

function NetworkHistoryValue({
  direction,
  value,
  average,
  peak,
}: {
  direction: "down" | "up"
  value: number | null
  average: number | null
  peak: number | null
}) {
  return (
    <div className="min-w-0 px-3 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[9px] tracking-[0.06em] text-muted-foreground/70 uppercase">
          {direction === "down" ? "↓ In" : "↑ Out"}
        </span>
        <span
          className={`truncate font-mono text-[13px] leading-none font-semibold tracking-[-0.03em] tabular-nums ${direction === "down" ? "text-cyan-200/95" : "text-primary"}`}
        >
          {value === null ? "—" : formatBytesPerSecond(value)}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[7px] leading-none tracking-[0.02em] text-muted-foreground/60 uppercase tabular-nums">
        <span>
          Avg {average === null ? "—" : formatBytesPerSecond(average)}
        </span>
        <span>Peak {peak === null ? "—" : formatBytesPerSecond(peak)}</span>
      </div>
    </div>
  )
}

function historyStatistics(values: Array<number | null>): {
  average: number | null
  peak: number | null
} {
  const samples = values.filter((value): value is number => value !== null)
  return {
    average: samples.length
      ? samples.reduce((total, value) => total + value, 0) / samples.length
      : null,
    peak: samples.length ? Math.max(...samples) : null,
  }
}

function formatHistoryValue(
  resource: ResourceItem["id"],
  value: number
): string {
  return resource === "network"
    ? formatBytesPerSecond(value)
    : formatPercent(value)
}

function formatPercent(value: number | undefined): string {
  if (value === undefined) return "—"
  if (value >= 100) return `${Math.round(value)}%`
  return `${value.toFixed(value < 10 ? 1 : 0)}%`
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  )
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function formatBytesPerSecond(bytes: number): string {
  return `${formatBytes(bytes)}/s`
}

function formatCompactBytesPerSecond(bytes: number): string {
  return formatBytesPerSecond(bytes).replace(" ", "")
}

function formatUptime(totalSeconds: number): string {
  const totalMinutes = Math.floor(totalSeconds / 60)
  const days = Math.floor(totalMinutes / 1_440)
  const hours = Math.floor((totalMinutes % 1_440) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function networkActivityPercent(bytesPerSecond: number): number {
  if (bytesPerSecond <= 0) return 0
  return Math.min(
    (Math.log10(bytesPerSecond + 1) / Math.log10(10 * 1024 * 1024 + 1)) * 100,
    100
  )
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
