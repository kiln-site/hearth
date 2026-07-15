import * as React from "react"
import type { RelayInstance, RelayNode } from "@workspace/contracts"
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

import type { InstanceTab } from "@/components/app-sidebar"
import { ConsoleWorkspace } from "@/components/console-workspace"
import { ToolbarSidebarTrigger } from "@/components/global-page-toolbar"
import { PanelFooter } from "@/components/panel-footer"
import { SettingsWorkspace } from "@/components/settings-workspace"
import { performRelayAction } from "@/server/relay"

const FileWorkspace = React.lazy(async () => {
  const module = await import("@/components/file-workspace")
  return { default: module.FileWorkspace }
})

const ResourceHistoryChart = React.lazy(async () => {
  const module = await import("@/components/resource-history-chart")
  return { default: module.ResourceHistoryChart }
})

export function InstanceWorkspace({
  instance,
  node,
  activeTab,
  filePath,
  permissions,
  onInstanceUpdate,
}: {
  instance: RelayInstance
  node: RelayNode
  activeTab: InstanceTab
  filePath?: string
  permissions: {
    consoleWrite: boolean
    filesWrite: boolean
    power: boolean
    settings: boolean
    shareLogs: boolean
  }
  onInstanceUpdate: (instance: RelayInstance) => void
}) {
  const [action, setAction] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [serverActionsOpen, setServerActionsOpen] = React.useState(false)
  const [confirmKill, setConfirmKill] = React.useState(false)
  const [idCopied, setIdCopied] = React.useState(false)
  const [addressCopied, setAddressCopied] = React.useState(false)
  const [retainedFilesFor, setRetainedFilesFor] = React.useState<string | null>(
    activeTab === "files" ? instance.id : null
  )
  const addressCopyTimer = React.useRef<number | null>(null)
  const idCopyTimer = React.useRef<number | null>(null)
  const isRunning = instance.observedState === "running"
  const isStarting = instance.observedState === "starting"
  const isStopping = instance.observedState === "stopping"
  const powerIsOn = isRunning || isStarting
  const startUnavailable = powerIsOn || isStopping || action !== null
  const stopUnavailable = !powerIsOn || isStopping || action !== null
  const title =
    activeTab === "console"
      ? "Console"
      : activeTab === "files"
        ? "Files"
        : "Info"
  const hasFileWorkspace =
    activeTab === "files" || retainedFilesFor === instance.id

  React.useEffect(() => {
    if (activeTab === "files") setRetainedFilesFor(instance.id)
  }, [activeTab, instance.id])

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

  async function handleAction(
    nextAction: "start" | "stop" | "restart" | "kill"
  ) {
    setAction(nextAction)
    setError(null)
    try {
      onInstanceUpdate(
        await performRelayAction({
          data: { instanceId: instance.id, action: nextAction },
        })
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Relay action failed")
    } finally {
      setAction(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="shrink-0 border-b bg-background/90 backdrop-blur-xl">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 px-3 py-3 sm:px-5 lg:min-h-20 lg:py-2 xl:grid-cols-[minmax(0,1fr)_39rem_auto] xl:gap-x-5">
          <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
            <ToolbarSidebarTrigger />
            <span
              className="h-6 w-px shrink-0 bg-border/80"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <h1
                className="flex min-w-0 items-baseline gap-1.5 font-heading tracking-[-0.03em]"
                title={`${instance.name} / ${title}`}
              >
                <span className="min-w-0 truncate text-lg font-semibold text-foreground sm:text-xl">
                  {instance.name}
                </span>
                <span className="shrink-0 text-border">/</span>
                <span className="shrink-0 text-sm font-medium text-muted-foreground sm:text-base">
                  {title}
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
                      <span className="truncate">
                        {instance.connectAddress}
                      </span>
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
                <p className="mt-0.5 truncate text-[9px] text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          </div>

          <ResourceMeters instance={instance} />

          <div className="col-start-2 row-start-1 flex items-center justify-end gap-1.5 xl:col-start-3">
            {permissions.power ? (
              <Button
                variant="outline"
                size="sm"
                className={
                  powerIsOn
                    ? "hidden h-9 gap-1.5 !border-red-500/65 !bg-red-600 px-3 text-xs !text-white shadow-none hover:!border-red-400 hover:!bg-red-500 disabled:!border-red-500/35 disabled:!bg-red-600/45 disabled:!text-white/70 md:inline-flex"
                    : "hidden h-9 gap-1.5 !border-blue-500/65 !bg-blue-600 px-3 text-xs !text-white shadow-none hover:!border-blue-400 hover:!bg-blue-500 md:inline-flex"
                }
                disabled={action !== null || isStopping}
                onClick={() => handleAction(powerIsOn ? "stop" : "start")}
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
            ) : null}
            {permissions.power ? (
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
                        disabled={action !== null}
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
                    Server power and lifecycle actions
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
                          This immediately terminates the container. Unsaved
                          world data may be lost.
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
                          onClick={() => {
                            setServerActionsOpen(false)
                            setConfirmKill(false)
                            void handleAction("kill")
                          }}
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
                      <button
                        type="button"
                        className={`flex w-full items-center gap-2.5 px-2 py-2 text-left text-xs transition-colors ${startUnavailable ? "cursor-default text-muted-foreground/35" : "text-blue-300 hover:bg-blue-500/10"}`}
                        disabled={startUnavailable}
                        onClick={() => {
                          setServerActionsOpen(false)
                          void handleAction("start")
                        }}
                      >
                        <span
                          className={`grid size-7 place-items-center border ${startUnavailable ? "border-border/55 bg-muted/15" : "border-blue-500/25 bg-blue-500/5"}`}
                        >
                          <Play className="size-3.5" />
                        </span>
                        <span>
                          <span className="block font-medium">Start</span>
                          <span
                            className={`block text-[10px] ${startUnavailable ? "text-muted-foreground/30" : "text-muted-foreground"}`}
                          >
                            Power on the server
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-2.5 px-2 py-2 text-left text-xs transition-colors ${stopUnavailable ? "cursor-default text-muted-foreground/35" : "text-red-400 hover:bg-red-500/10"}`}
                        disabled={stopUnavailable}
                        onClick={() => {
                          setServerActionsOpen(false)
                          void handleAction("stop")
                        }}
                      >
                        <span
                          className={`grid size-7 place-items-center border ${stopUnavailable ? "border-border/55 bg-muted/15" : "border-red-500/25 bg-red-500/5"}`}
                        >
                          <CircleStop className="size-3.5" />
                        </span>
                        <span>
                          <span className="block font-medium">Stop</span>
                          <span
                            className={`block text-[10px] ${stopUnavailable ? "text-muted-foreground/30" : "text-muted-foreground"}`}
                          >
                            Gracefully shut down
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2.5 px-2 py-2 text-left text-xs text-foreground transition-colors hover:bg-popover-accent/80 focus-visible:bg-popover-accent focus-visible:outline-none disabled:cursor-default disabled:opacity-35"
                        disabled={!isRunning}
                        onClick={() => {
                          setServerActionsOpen(false)
                          void handleAction("restart")
                        }}
                      >
                        <span className="grid size-7 place-items-center border border-border bg-card text-muted-foreground">
                          <RotateCw className="size-3.5" />
                        </span>
                        <span>
                          <span className="block font-medium">Restart</span>
                          <span className="block text-[10px] text-muted-foreground">
                            Gracefully stop and start
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2.5 px-2 py-2 text-left text-xs text-red-400 transition-colors hover:bg-red-500/10 disabled:cursor-default disabled:opacity-35"
                        disabled={!powerIsOn || isStopping}
                        onClick={() => setConfirmKill(true)}
                      >
                        <span className="grid size-7 place-items-center border border-red-500/25 bg-red-500/5">
                          <OctagonX className="size-3.5" />
                        </span>
                        <span>
                          <span className="block font-medium">Kill</span>
                          <span className="block text-[10px] text-muted-foreground">
                            Terminate immediately
                          </span>
                        </span>
                      </button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            ) : null}
          </div>
        </div>
      </header>

      <div
        data-slot="instance-workspace-surface"
        className="relative mx-2 mt-2 flex min-h-0 flex-1 overflow-hidden border border-border/80 bg-card/30"
      >
        <div
          aria-hidden={activeTab !== "console"}
          inert={activeTab !== "console"}
          className={`absolute inset-0 flex ${activeTab === "console" ? "visible" : "pointer-events-none invisible"}`}
        >
          <ConsoleWorkspace
            key={instance.id}
            instance={instance}
            active={activeTab === "console"}
            canShare={permissions.shareLogs}
            canWrite={permissions.consoleWrite}
          />
        </div>
        {hasFileWorkspace ? (
          <div
            aria-hidden={activeTab !== "files"}
            inert={activeTab !== "files"}
            className={`absolute inset-0 flex ${activeTab === "files" ? "visible" : "pointer-events-none invisible"}`}
          >
            <React.Suspense
              fallback={
                <div className="grid min-h-0 flex-1 place-items-center bg-card text-xs text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <LoaderCircle className="size-4 animate-spin text-primary" />
                    Opening file workspace
                  </span>
                </div>
              }
            >
              <FileWorkspace
                key={instance.id}
                instance={instance}
                active={activeTab === "files"}
                routeFilePath={filePath}
                canShare={permissions.shareLogs}
                canWrite={permissions.filesWrite}
              />
            </React.Suspense>
          </div>
        ) : null}
        <div
          aria-hidden={activeTab !== "info"}
          inert={activeTab !== "info"}
          className={`absolute inset-0 flex ${activeTab === "info" ? "visible" : "pointer-events-none invisible"}`}
        >
          <SettingsWorkspace
            instance={instance}
            node={node}
            canRename={permissions.settings}
            onInstanceUpdate={onInstanceUpdate}
          />
        </div>
      </div>
      <PanelFooter
        className={activeTab === "info" ? undefined : "max-md:hidden"}
      />
    </div>
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

function ResourceMeters({ instance }: { instance: RelayInstance }) {
  const resources = resourceItems(instance)
  const history = useResourceHistory(instance)
  const uptime = useInstanceUptime(instance)
  const startedAt = useBrowserLocalTimestamp(instance.startedAt)

  return (
    <div
      className="hidden min-w-0 md:col-span-2 md:block xl:col-span-1 xl:col-start-2 xl:row-start-1"
      aria-label="Server resource usage"
    >
      <div className="grid h-14 min-w-0 grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.25fr)_5.5rem] divide-x divide-border/60 border border-border/80 bg-card/40 px-1.5 py-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.15fr)_5.75rem]">
        {resources.map((resource) => (
          <ResourceHistoryHoverCard
            key={resource.id}
            resource={resource}
            history={history}
          >
            <div
              className={`group min-w-0 outline-none first:pl-1.5 focus-visible:bg-muted/25 ${resource.id === "network" ? "px-1.5" : "px-2.5"}`}
              tabIndex={0}
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
            </div>
          </ResourceHistoryHoverCard>
        ))}
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
              <time
                dateTime={instance.startedAt ?? undefined}
                className="block font-mono text-xs whitespace-nowrap text-foreground/85"
              >
                {startedAt}
              </time>
            </HoverCardContent>
          ) : null}
        </HoverCard>
      </div>
    </div>
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

function useInstanceUptime(instance: RelayInstance): string | null {
  const [now, setNow] = React.useState(() => Date.now())
  const startedAt = instance.startedAt ? Date.parse(instance.startedAt) : NaN
  const running = instance.observedState === "running"

  React.useEffect(() => {
    setNow(Date.now())
    if (!running || !Number.isFinite(startedAt)) return

    const interval = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(interval)
  }, [instance.id, running, startedAt])

  if (!running || !Number.isFinite(startedAt)) return null
  return formatUptime(Math.max(0, Math.floor((now - startedAt) / 1_000)))
}

function useBrowserLocalTimestamp(value: string | null): string | null {
  const [formatted, setFormatted] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!value) {
      setFormatted(null)
      return
    }

    const timestamp = Date.parse(value)
    if (!Number.isFinite(timestamp)) {
      setFormatted(null)
      return
    }

    setFormatted(
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "long",
      }).format(new Date(timestamp))
    )
  }, [value])

  return formatted
}

function resourceItems(instance: RelayInstance): Array<ResourceItem> {
  const resources = instance.resources
  const unavailable =
    instance.observedState === "running" ? "Sampling" : "Offline"

  return [
    {
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
    },
    {
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
    },
    {
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
    },
    {
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
    },
  ]
}

function ResourceBar({
  resource,
  className = "",
}: {
  resource: ResourceItem
  className?: string
}) {
  const width = (value: number | null | undefined) =>
    value === null || value === undefined
      ? 0
      : Math.max(1, Math.min(value, 100))

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
              style={{ width: `${width(resource.receivedValue)}%` }}
            />
          </div>
          <div className="overflow-hidden bg-muted/55">
            <div
              className="h-full bg-primary/75 transition-[width] duration-500 ease-out"
              style={{ width: `${width(resource.sentValue)}%` }}
            />
          </div>
        </>
      ) : (
        <div
          className={`h-full transition-[width] duration-500 ease-out ${resource.indicatorClassName}`}
          style={{ width: `${width(resource.value)}%` }}
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

interface ResourceHistoryState {
  instanceId: string
  points: Array<ResourceHistoryPoint>
}

function useResourceHistory(instance: RelayInstance) {
  const [history, setHistory] = React.useState<ResourceHistoryState>(() => ({
    instanceId: instance.id,
    points: [],
  }))

  React.useEffect(() => {
    const resources = instance.resources

    setHistory((current) => {
      const currentPoints =
        current.instanceId === instance.id ? current.points : []

      if (!resources) {
        return current.instanceId === instance.id
          ? current
          : { instanceId: instance.id, points: [] }
      }

      const timestamp = Date.parse(resources.sampledAt)
      if (!Number.isFinite(timestamp)) return current
      if (currentPoints.at(-1)?.timestamp === timestamp) return current

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

      return {
        instanceId: instance.id,
        points: [...currentPoints, point].filter(
          (sample) => timestamp - sample.timestamp <= 60_000
        ),
      }
    })
  }, [instance.id, instance.resources])

  return history.instanceId === instance.id ? history.points : []
}

function ResourceHistoryHoverCard({
  resource,
  history,
  children,
}: {
  resource: ResourceItem
  history: Array<ResourceHistoryPoint>
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
        className="w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden border-border/90 bg-popover p-0 shadow-2xl"
      >
        <ResourceHistoryCard resource={resource} history={history} />
      </HoverCardContent>
    </HoverCard>
  )
}

function ResourceHistoryCard({
  resource,
  history,
}: {
  resource: ResourceItem
  history: Array<ResourceHistoryPoint>
}) {
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
    <div>
      <div className="flex items-start justify-between gap-4 border-b border-border/70 px-3.5 py-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {resource.label} history
          </p>
          <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
            {resource.historyDetail ?? resource.detail}
          </p>
        </div>
        {resource.id === "network" ? (
          <div className="flex shrink-0 items-start gap-3 text-right">
            <NetworkHistoryValue
              direction="down"
              value={latest?.networkReceived ?? null}
              average={receivedStats.average}
              peak={receivedStats.peak}
            />
            <NetworkHistoryValue
              direction="up"
              value={latest?.networkSent ?? null}
              average={sentStats.average}
              peak={sentStats.peak}
            />
          </div>
        ) : (
          <div className="shrink-0 text-right">
            <span
              className={`block font-mono text-base font-semibold tabular-nums ${resource.valueClassName}`}
            >
              {resource.displayValue}
            </span>
            <span className="mt-1 block font-mono text-[8px] leading-none tracking-[0.05em] text-muted-foreground tabular-nums">
              AVG{" "}
              {average === null
                ? "—"
                : formatHistoryValue(resource.id, average)}
              <span className="px-1 text-border">·</span>
              PEAK {peak === null ? "—" : formatHistoryValue(resource.id, peak)}
            </span>
          </div>
        )}
      </div>

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
    <div>
      <span
        className={`block font-mono text-sm font-semibold tabular-nums ${direction === "down" ? "text-cyan-200/95" : "text-primary"}`}
      >
        {direction === "down" ? "↓" : "↑"}{" "}
        {value === null ? "—" : formatBytesPerSecond(value)}
      </span>
      <span className="mt-1 block font-mono text-[7px] leading-none tracking-[0.04em] text-muted-foreground tabular-nums">
        AVG {average === null ? "—" : formatBytesPerSecond(average)}
        <span className="px-1 text-border">·</span>PEAK{" "}
        {peak === null ? "—" : formatBytesPerSecond(peak)}
      </span>
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
