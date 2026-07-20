import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import type {
  RelayConsole,
  RelayConsoleLevel,
  RelayConsoleLine,
} from "@workspace/contracts"
import {
  ArrowDown,
  Check,
  Clock3,
  Copy,
  CornerDownLeft,
  EyeOff,
  ListFilter,
  LoaderCircle,
  Search,
  Share2,
  TriangleAlert,
  WifiOff,
  WrapText,
  X,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import { openRelayConsoleStream } from "@/lib/relay-console-stream"
import { redactSensitiveText } from "@/lib/redaction"
import { queryKeys, relaySnapshotQueryOptions } from "@/lib/query-options"
import { selectInstanceObservedState } from "@/lib/relay-selectors"
import type { InstanceWorkspaceInstance } from "@/lib/relay-selectors"
import {
  completeRelayCommand,
  sendRelayCommand,
  uploadLatestLogToMclogs,
} from "@/server/relay"

const LEVELS: Array<RelayConsoleLevel> = [
  "info",
  "warn",
  "error",
  "debug",
  "trace",
]
const consoleTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})

interface CommandCompletions {
  cursor: number
  input: string
  selectedIndex: number
  status: "empty" | "loading" | "ready" | "unavailable"
  suggestions: Array<{
    label: string
    value: string
  }>
}

interface ConsoleFilterSnapshot {
  levels: Set<RelayConsoleLevel>
  query: string
  redactSensitive: boolean
}

interface ConsoleUiStore {
  clearSelection: () => void
  getFilterSnapshot: () => ConsoleFilterSnapshot
  getLevelsSnapshot: () => Set<RelayConsoleLevel>
  getLineSelectedSnapshot: (lineId: string) => boolean
  getQuerySnapshot: () => string
  getRedactSensitiveSnapshot: () => boolean
  getSelectedSnapshot: () => Set<string>
  getSelectedText: () => string
  getShowTimestampsSnapshot: () => boolean
  getWrapLinesSnapshot: () => boolean
  setFilteredLines: (lines: Array<RelayConsoleLine>) => void
  setQuery: (query: string) => void
  subscribe: (listener: () => void) => () => void
  toggleLevel: (level: RelayConsoleLevel | "all") => void
  toggleLine: (line: RelayConsoleLine, index: number, shift: boolean) => void
  toggleRedactSensitive: () => void
  toggleShowTimestamps: () => void
  toggleWrapLines: () => void
}

interface ConsoleStreamSnapshot {
  connection: "connecting" | "live" | "unavailable"
  consoleData: RelayConsole | null
  loading: boolean
}

interface ConsoleStreamStore {
  getHasLinesSnapshot: () => boolean
  getSnapshot: () => ConsoleStreamSnapshot
  setSnapshot: (snapshot: ConsoleStreamSnapshot) => void
  subscribe: (listener: () => void) => () => void
}

function createConsoleStreamStore(): ConsoleStreamStore {
  let snapshot: ConsoleStreamSnapshot = {
    connection: "connecting",
    consoleData: null,
    loading: true,
  }
  const listeners = new Set<() => void>()
  return {
    getHasLinesSnapshot: () => Boolean(snapshot.consoleData?.lines.length),
    getSnapshot: () => snapshot,
    setSnapshot: (nextSnapshot) => {
      if (
        snapshot.consoleData === nextSnapshot.consoleData &&
        snapshot.connection === nextSnapshot.connection &&
        snapshot.loading === nextSnapshot.loading
      ) {
        return
      }
      snapshot = nextSnapshot
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function createConsoleUiStore(): ConsoleUiStore {
  let query = ""
  let levels = new Set(LEVELS)
  let redactSensitive = true
  let showTimestamps = false
  let wrapLines = true
  let selected = new Set<string>()
  let filteredLines: Array<RelayConsoleLine> = []
  let lastSelected: number | null = null
  let filterSnapshot: ConsoleFilterSnapshot = {
    levels,
    query,
    redactSensitive,
  }
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const updateFilterSnapshot = () => {
    filterSnapshot = { levels, query, redactSensitive }
    notify()
  }

  return {
    clearSelection: () => {
      if (selected.size === 0) return
      selected = new Set()
      lastSelected = null
      notify()
    },
    getFilterSnapshot: () => filterSnapshot,
    getLevelsSnapshot: () => levels,
    getLineSelectedSnapshot: (lineId) => selected.has(lineId),
    getQuerySnapshot: () => query,
    getRedactSensitiveSnapshot: () => redactSensitive,
    getSelectedSnapshot: () => selected,
    getSelectedText: () => {
      const lines: Array<string> = []
      for (const line of filteredLines) {
        if (selected.has(line.id)) lines.push(line.text)
      }
      return lines.join("\n")
    },
    getShowTimestampsSnapshot: () => showTimestamps,
    getWrapLinesSnapshot: () => wrapLines,
    setFilteredLines: (lines) => {
      filteredLines = lines
    },
    setQuery: (nextQuery) => {
      if (query === nextQuery) return
      query = nextQuery
      updateFilterSnapshot()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    toggleLevel: (level) => {
      if (level === "all") {
        levels = new Set(LEVELS)
      } else if (levels.size === LEVELS.length) {
        levels = new Set([level])
      } else {
        const next = new Set(levels)
        if (next.has(level) && next.size === 1) levels = new Set(LEVELS)
        else {
          if (next.has(level)) next.delete(level)
          else next.add(level)
          levels = next
        }
      }
      updateFilterSnapshot()
    },
    toggleLine: (line, index, shift) => {
      const next = new Set(selected)
      if (shift && lastSelected !== null) {
        const start = Math.min(lastSelected, index)
        const end = Math.max(lastSelected, index)
        for (let cursor = start; cursor <= end; cursor++) {
          const selectedLine = filteredLines.at(cursor)
          if (selectedLine) next.add(selectedLine.id)
        }
      } else if (next.has(line.id)) next.delete(line.id)
      else next.add(line.id)
      selected = next
      lastSelected = index
      notify()
    },
    toggleRedactSensitive: () => {
      redactSensitive = !redactSensitive
      updateFilterSnapshot()
    },
    toggleShowTimestamps: () => {
      showTimestamps = !showTimestamps
      notify()
    },
    toggleWrapLines: () => {
      wrapLines = !wrapLines
      notify()
    },
  }
}

export function ConsoleWorkspace({
  instance,
  active,
  canShare,
  canWrite,
}: {
  instance: InstanceWorkspaceInstance
  active: boolean
  canShare: boolean
  canWrite: boolean
}) {
  return (
    <ConsoleWorkspaceSession
      key={`${instance.relayId}:${instance.id}`}
      instance={instance}
      active={active}
      canShare={canShare}
      canWrite={canWrite}
    />
  )
}

function ConsoleWorkspaceSession({
  instance,
  active,
  canShare,
  canWrite,
}: {
  instance: InstanceWorkspaceInstance
  active: boolean
  canShare: boolean
  canWrite: boolean
}) {
  const relayConnected = instance.relayStatus === "connected"
  const [uiStore] = React.useState(createConsoleUiStore)
  const [streamStore] = React.useState(createConsoleStreamStore)

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-card">
      <ConsoleStreamController
        instanceId={instance.id}
        relayId={instance.relayId}
        relayConnected={relayConnected}
        streamStore={streamStore}
      />
      <ConsoleToolbar
        active={active}
        canShare={canShare && relayConnected}
        instance={instance}
        streamStore={streamStore}
        uiStore={uiStore}
      />
      <ConsoleLogViewportController
        active={active}
        relayConnected={relayConnected}
        streamStore={streamStore}
        uiStore={uiStore}
      />

      <ConsoleCommandBar
        active={active}
        canWrite={canWrite}
        instance={instance}
        relayConnected={relayConnected}
        streamStore={streamStore}
      />
    </section>
  )
}

function ConsoleStreamController({
  instanceId,
  relayId,
  relayConnected,
  streamStore,
}: {
  instanceId: string
  relayId: string
  relayConnected: boolean
  streamStore: ConsoleStreamStore
}) {
  const snapshot = useRelayConsoleStream(relayId, instanceId, relayConnected)
  React.useLayoutEffect(
    () => streamStore.setSnapshot(snapshot),
    [snapshot, streamStore]
  )
  return null
}

function ConsoleLogViewportController({
  active,
  relayConnected,
  streamStore,
  uiStore,
}: {
  active: boolean
  relayConnected: boolean
  streamStore: ConsoleStreamStore
  uiStore: ConsoleUiStore
}) {
  const { connection, consoleData, loading } = React.useSyncExternalStore(
    streamStore.subscribe,
    streamStore.getSnapshot,
    streamStore.getSnapshot
  )
  const filters = React.useSyncExternalStore(
    uiStore.subscribe,
    uiStore.getFilterSnapshot,
    uiStore.getFilterSnapshot
  )
  const filteredLines = React.useMemo(() => {
    const normalizedQuery = filters.query.trim().toLowerCase()
    const filtered: Array<RelayConsoleLine> = []
    for (const line of consoleData?.lines ?? []) {
      const text = filters.redactSensitive
        ? redactSensitiveText(line.text)
        : line.text
      if (
        filters.levels.has(line.level) &&
        (!normalizedQuery || text.toLowerCase().includes(normalizedQuery))
      ) {
        filtered.push({ ...line, text })
      }
    }
    return filtered
  }, [consoleData?.lines, filters])

  React.useLayoutEffect(() => {
    uiStore.setFilteredLines(filteredLines)
  }, [filteredLines, uiStore])

  return (
    <ConsoleLogViewport
      active={active}
      consoleData={consoleData}
      connection={relayConnected ? connection : "unavailable"}
      filteredLines={filteredLines}
      loading={loading}
      uiStore={uiStore}
    />
  )
}

interface ConsoleToolbarProps {
  active: boolean
  canShare: boolean
  instance: InstanceWorkspaceInstance
  streamStore: ConsoleStreamStore
  uiStore: ConsoleUiStore
}

const ConsoleToolbar = React.memo(function ConsoleToolbar({
  active,
  canShare,
  instance,
  streamStore,
  uiStore,
}: ConsoleToolbarProps) {
  return (
    <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2.5 sm:px-4">
      <ConsoleSearchControl uiStore={uiStore} />
      <ConsoleLevelMenu uiStore={uiStore} />
      <div className="ml-auto flex items-center gap-1.5">
        <ConsoleShareButton
          canShare={canShare}
          instance={instance}
          streamStore={streamStore}
          uiStore={uiStore}
        />
        <ConsoleSelectionControl active={active} uiStore={uiStore} />
        <ConsoleRedactButton uiStore={uiStore} />
        {canShare ? <ConsoleWrapButton uiStore={uiStore} /> : null}
        <ConsoleTimestampButton uiStore={uiStore} />
      </div>
    </div>
  )
})

function ConsoleSearchControl({ uiStore }: { uiStore: ConsoleUiStore }) {
  const query = React.useSyncExternalStore(
    uiStore.subscribe,
    uiStore.getQuerySnapshot,
    uiStore.getQuerySnapshot
  )
  return (
    <div className="relative min-w-[12rem] flex-1 sm:max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(event) => uiStore.setQuery(event.target.value)}
        placeholder="Search console"
        aria-label="Search console"
        className="h-9 border-border/80 bg-background pl-8 text-base shadow-none sm:text-xs"
      />
      {query ? (
        <button
          type="button"
          aria-label="Clear console search"
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => uiStore.setQuery("")}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

function ConsoleLevelMenu({ uiStore }: { uiStore: ConsoleUiStore }) {
  const levels = React.useSyncExternalStore(
    uiStore.subscribe,
    uiStore.getLevelsSnapshot,
    uiStore.getLevelsSnapshot
  )
  const allLevels = levels.size === LEVELS.length
  return (
    <Popover>
      <ConsoleTooltip content="Filter Log Level">
        <PopoverTrigger asChild>
          <Button
            variant={allLevels ? "ghost" : "secondary"}
            size="icon"
            className="relative size-9 shrink-0"
            aria-label={
              allLevels
                ? "Filter console levels"
                : `Filter console levels, ${levels.size} active`
            }
          >
            <ListFilter />
            {!allLevels ? (
              <span
                className="absolute top-1 right-1 size-1.5 bg-primary"
                aria-hidden="true"
              />
            ) : null}
          </Button>
        </PopoverTrigger>
      </ConsoleTooltip>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={7}
        className="w-52 p-1"
      >
        <div className="flex items-center justify-between border-b px-2 py-2">
          <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Console levels
          </p>
          <span className="font-mono text-[9px] text-muted-foreground/75 tabular-nums">
            {levels.size}/{LEVELS.length}
          </span>
        </div>
        <ConsoleLevelFilter
          active={allLevels}
          label="All levels"
          onClick={() => uiStore.toggleLevel("all")}
        />
        <div className="my-1 border-t" />
        {LEVELS.map((level) => (
          <ConsoleLevelFilter
            key={level}
            active={levels.has(level)}
            level={level}
            label={level}
            onClick={() => uiStore.toggleLevel(level)}
          />
        ))}
      </PopoverContent>
    </Popover>
  )
}

function ConsoleShareButton({
  canShare,
  instance,
  streamStore,
  uiStore,
}: {
  canShare: boolean
  instance: InstanceWorkspaceInstance
  streamStore: ConsoleStreamStore
  uiStore: ConsoleUiStore
}) {
  const [state, setState] = React.useState<
    "idle" | "uploading" | "copied" | "error"
  >("idle")
  const resetTimer = React.useRef<number | null>(null)
  const hasLines = React.useSyncExternalStore(
    streamStore.subscribe,
    streamStore.getHasLinesSnapshot,
    streamStore.getHasLinesSnapshot
  )
  React.useEffect(
    () => () => {
      if (resetTimer.current) window.clearTimeout(resetTimer.current)
    },
    []
  )
  if (!canShare) return null

  async function handleShare() {
    setState("uploading")
    try {
      const result = await uploadLatestLogToMclogs({
        data: {
          instanceId: instance.id,
          relayId: instance.relayId,
          implementation: instance.implementation,
          version: instance.version,
          redactSensitive: uiStore.getRedactSensitiveSnapshot(),
        },
      })
      await copyToClipboard(result.url)
      setState("copied")
    } catch {
      setState("error")
    }
    if (resetTimer.current) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setState("idle"), 2800)
  }

  return (
    <ConsoleTooltip content={shareTooltip(state)}>
      <Button
        variant={
          state === "copied"
            ? "secondary"
            : state === "error"
              ? "destructive"
              : "ghost"
        }
        size="sm"
        className="h-8 gap-1.5 px-2.5 text-[11px]"
        disabled={state === "uploading" || !hasLines}
        onClick={handleShare}
      >
        {state === "uploading" ? (
          <LoaderCircle className="animate-spin" />
        ) : state === "copied" ? (
          <Check />
        ) : state === "error" ? (
          <TriangleAlert />
        ) : (
          <Share2 />
        )}
        {shareLabel(state)}
      </Button>
    </ConsoleTooltip>
  )
}

function ConsoleSelectionControl({
  active,
  uiStore,
}: {
  active: boolean
  uiStore: ConsoleUiStore
}) {
  const selected = React.useSyncExternalStore(
    uiStore.subscribe,
    uiStore.getSelectedSnapshot,
    uiStore.getSelectedSnapshot
  )
  const [copiedSelection, setCopiedSelection] =
    React.useState<Set<string> | null>(null)
  const resetTimer = React.useRef<number | null>(null)
  const selectedCount = selected.size
  const copied = copiedSelection === selected

  React.useEffect(() => {
    if (!active || selectedCount === 0) return
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") uiStore.clearSelection()
    }
    window.addEventListener("keydown", handleEscape, { capture: true })
    return () => window.removeEventListener("keydown", handleEscape, true)
  }, [active, selectedCount, uiStore])

  React.useEffect(
    () => () => {
      if (resetTimer.current) window.clearTimeout(resetTimer.current)
    },
    []
  )

  async function handleCopy() {
    await copyToClipboard(uiStore.getSelectedText())
    setCopiedSelection(selected)
    if (resetTimer.current) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setCopiedSelection(null), 1800)
  }

  return (
    <Popover open={selectedCount > 0}>
      <PopoverAnchor asChild>
        <span className="inline-flex">
          <ConsoleTooltip
            content={copied ? "Selected Lines Copied" : "Copy Selected Lines"}
          >
            <Button
              variant={copied ? "secondary" : "ghost"}
              size="icon"
              className="size-8"
              aria-label={
                selectedCount > 0
                  ? `Copy ${selectedCount} Selected ${selectedCount === 1 ? "Line" : "Lines"}`
                  : "Copy Selected Lines"
              }
              disabled={selectedCount === 0}
              onClick={handleCopy}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
          </ConsoleTooltip>
        </span>
      </PopoverAnchor>
      <PopoverContent
        align="center"
        side="bottom"
        sideOffset={7}
        className="flex w-auto min-w-36 items-center gap-2 px-2.5 py-2"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={uiStore.clearSelection}
      >
        <span
          className="font-mono text-[10px] whitespace-nowrap text-muted-foreground"
          aria-live="polite"
        >
          {copied
            ? `${selectedCount} ${selectedCount === 1 ? "line" : "lines"} copied`
            : `${selectedCount} ${selectedCount === 1 ? "line" : "lines"} selected`}
        </span>
        <ConsoleTooltip content="Clear Selection">
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Clear selected console lines"
            onClick={uiStore.clearSelection}
          >
            <X className="size-3.5" />
          </Button>
        </ConsoleTooltip>
      </PopoverContent>
    </Popover>
  )
}

function ConsoleRedactButton({ uiStore }: { uiStore: ConsoleUiStore }) {
  const redactSensitive = React.useSyncExternalStore(
    uiStore.subscribe,
    uiStore.getRedactSensitiveSnapshot,
    uiStore.getRedactSensitiveSnapshot
  )
  return (
    <ConsoleTooltip content={redactSensitive ? "Show IPs" : "Censor IPs"}>
      <Button
        variant={redactSensitive ? "secondary" : "ghost"}
        size="icon"
        className="size-8"
        aria-label={redactSensitive ? "Show IPs" : "Censor IPs"}
        aria-pressed={redactSensitive}
        onClick={uiStore.toggleRedactSensitive}
      >
        <EyeOff />
      </Button>
    </ConsoleTooltip>
  )
}

function ConsoleWrapButton({ uiStore }: { uiStore: ConsoleUiStore }) {
  const wrapLines = React.useSyncExternalStore(
    uiStore.subscribe,
    uiStore.getWrapLinesSnapshot,
    uiStore.getWrapLinesSnapshot
  )
  return (
    <ConsoleTooltip
      content={wrapLines ? "Disable Line Wrap" : "Enable Line Wrap"}
    >
      <Button
        variant={wrapLines ? "secondary" : "ghost"}
        size="icon"
        className="size-8"
        aria-label={wrapLines ? "Disable Line Wrap" : "Enable Line Wrap"}
        aria-pressed={wrapLines}
        onClick={uiStore.toggleWrapLines}
      >
        <WrapText />
      </Button>
    </ConsoleTooltip>
  )
}

function ConsoleTimestampButton({ uiStore }: { uiStore: ConsoleUiStore }) {
  const showTimestamps = React.useSyncExternalStore(
    uiStore.subscribe,
    uiStore.getShowTimestampsSnapshot,
    uiStore.getShowTimestampsSnapshot
  )
  return (
    <ConsoleTooltip
      content={showTimestamps ? "Hide Timestamps" : "Show Timestamps"}
    >
      <Button
        variant={showTimestamps ? "secondary" : "ghost"}
        size="icon"
        className="size-8"
        aria-label={showTimestamps ? "Hide timestamps" : "Show timestamps"}
        onClick={uiStore.toggleShowTimestamps}
      >
        <Clock3 />
      </Button>
    </ConsoleTooltip>
  )
}

interface ConsoleLogViewportProps {
  active: boolean
  connection: ConsoleStreamSnapshot["connection"]
  consoleData: RelayConsole | null
  filteredLines: Array<RelayConsoleLine>
  loading: boolean
  uiStore: ConsoleUiStore
}

function ConsoleLogViewport({
  active,
  connection,
  consoleData,
  filteredLines,
  loading,
  uiStore,
}: ConsoleLogViewportProps) {
  const [autoScroll, setAutoScroll] = React.useState(true)
  const query = React.useSyncExternalStore(
    uiStore.subscribe,
    uiStore.getQuerySnapshot,
    uiStore.getQuerySnapshot
  )
  const showTimestamps = React.useSyncExternalStore(
    uiStore.subscribe,
    uiStore.getShowTimestampsSnapshot,
    uiStore.getShowTimestampsSnapshot
  )
  const wrapLines = React.useSyncExternalStore(
    uiStore.subscribe,
    uiStore.getWrapLinesSnapshot,
    uiStore.getWrapLinesSnapshot
  )
  const parentRef = React.useRef<HTMLDivElement>(null)
  const programmaticScroll = React.useRef(false)
  const rowVirtualizer = useVirtualizer({
    count: filteredLines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 30,
    getItemKey: (index) => filteredLines[index]?.id ?? index,
    overscan: 18,
    anchorTo: "end",
    followOnAppend: true,
  })
  const rowVirtualizerRef = React.useRef(rowVirtualizer)
  React.useLayoutEffect(() => {
    rowVirtualizerRef.current = rowVirtualizer
  }, [rowVirtualizer])
  const measureRow = React.useCallback((element: Element | null) => {
    rowVirtualizerRef.current.measureElement(element)
  }, [])

  React.useLayoutEffect(() => {
    if (active) rowVirtualizer.measure()
  }, [active, rowVirtualizer, wrapLines])

  React.useLayoutEffect(() => {
    if (!active || !autoScroll || filteredLines.length === 0 || loading) return
    programmaticScroll.current = true
    rowVirtualizer.scrollToIndex(filteredLines.length - 1, { align: "end" })
    const frame = window.requestAnimationFrame(() => {
      programmaticScroll.current = false
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active, autoScroll, filteredLines.length, loading, rowVirtualizer])

  function resumeAutoScroll() {
    setAutoScroll(true)
    programmaticScroll.current = true
    if (filteredLines.length > 0) {
      rowVirtualizer.scrollToIndex(filteredLines.length - 1, { align: "end" })
    }
    window.requestAnimationFrame(() => {
      programmaticScroll.current = false
    })
  }

  return (
    <div className="relative min-h-0 flex-1 bg-[oklch(0.135_0.008_48)]">
      <div
        ref={parentRef}
        className={`absolute inset-0 overscroll-contain font-mono text-[11px] selection:bg-primary/25 sm:text-[12px] ${wrapLines ? "overflow-x-hidden overflow-y-auto" : "overflow-auto"}`}
        onScroll={(event) => {
          if (programmaticScroll.current) return
          const viewport = event.currentTarget
          const distanceFromBottom =
            viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
          if (distanceFromBottom <= 8) {
            if (!autoScroll) setAutoScroll(true)
            return
          }
          if (autoScroll && distanceFromBottom > 72) setAutoScroll(false)
        }}
      >
        <div
          className={wrapLines ? "relative w-full" : "relative min-w-max"}
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const line = filteredLines.at(virtualRow.index)
            if (!line) return null
            return (
              <ConsoleLogRow
                key={line.id}
                index={virtualRow.index}
                line={line}
                measureElement={measureRow}
                query={query}
                showTimestamps={showTimestamps}
                start={virtualRow.start}
                uiStore={uiStore}
                wrapLines={wrapLines}
              />
            )
          })}
        </div>
      </div>

      {!autoScroll ? (
        <div className="absolute right-4 bottom-4 z-20">
          <ConsoleTooltip content="Jump to the latest output and resume following.">
            <Button
              size="icon-lg"
              className="shadow-xl shadow-black/35"
              aria-label="Jump to latest output"
              onClick={resumeAutoScroll}
            >
              <ArrowDown />
            </Button>
          </ConsoleTooltip>
        </div>
      ) : null}

      {connection !== "live" && consoleData ? (
        <div className="pointer-events-none absolute top-3 left-1/2 z-20 -translate-x-1/2">
          <div className="flex items-center gap-1.5 border border-amber-400/20 bg-stone-950/90 px-2.5 py-1.5 font-mono text-[9px] text-amber-200 shadow-lg shadow-black/35 backdrop-blur-sm">
            <WifiOff className="size-3" />
            {connection === "connecting"
              ? "RECONNECTING · OUTPUT MAY BE DELAYED"
              : "LIVE OUTPUT PAUSED · SHOWING LAST RECEIVED LINES"}
          </div>
        </div>
      ) : null}

      {loading && !consoleData ? (
        <div className="absolute inset-0 grid place-items-center bg-card/70 backdrop-blur-[2px]">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin text-primary" />
            Opening live console stream
          </div>
        </div>
      ) : null}
      {!loading && !consoleData && connection === "unavailable" ? (
        <div className="absolute inset-0 grid place-items-center text-center">
          <div className="max-w-xs">
            <WifiOff className="mx-auto size-5 text-amber-300" />
            <p className="mt-3 text-sm font-semibold">Console unavailable</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Unable to connect to Relay. Last received output will appear here
              when available.
            </p>
          </div>
        </div>
      ) : null}
      {!loading && consoleData && filteredLines.length === 0 ? (
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-sm font-semibold">No matching output</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Adjust the search or log-level filters.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const ConsoleLogRow = React.memo(function ConsoleLogRow({
  index,
  line,
  measureElement,
  query,
  showTimestamps,
  start,
  uiStore,
  wrapLines,
}: {
  index: number
  line: RelayConsoleLine
  measureElement: (element: Element | null) => void
  query: string
  showTimestamps: boolean
  start: number
  uiStore: ConsoleUiStore
  wrapLines: boolean
}) {
  const getSelectedSnapshot = React.useCallback(
    () => uiStore.getLineSelectedSnapshot(line.id),
    [line.id, uiStore]
  )
  const selected = React.useSyncExternalStore(
    uiStore.subscribe,
    getSelectedSnapshot,
    getSelectedSnapshot
  )

  function toggle(shift: boolean) {
    uiStore.toggleLine(line, index, shift)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      ref={measureElement}
      data-index={index}
      className={`absolute left-0 flex min-h-[30px] border-l-2 pr-5 text-left transition-colors ${wrapLines ? "w-full items-start py-1.5 whitespace-pre-wrap" : "h-[30px] min-w-full items-center whitespace-nowrap"} ${lineTone(line.level, selected)}`}
      style={{
        transform: `translateY(${start}px)`,
        width: wrapLines ? "100%" : "max(100%, max-content)",
      }}
      onClick={(event) => toggle(event.shiftKey)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          toggle(event.shiftKey)
        }
      }}
    >
      {showTimestamps ? <ConsoleTimestamp timestamp={line.timestamp} /> : null}
      <span
        className={`min-w-0 flex-1 leading-[18px] ${wrapLines ? "break-words" : ""} ${showTimestamps ? "" : "ml-3"} ${lineTextTone(line.level)}`}
      >
        {renderConsoleText(line.text, query)}
      </span>
    </div>
  )
})

const ConsoleCommandBar = React.memo(function ConsoleCommandBar({
  active,
  canWrite,
  instance,
  relayConnected,
  streamStore,
}: {
  active: boolean
  canWrite: boolean
  instance: InstanceWorkspaceInstance
  relayConnected: boolean
  streamStore: ConsoleStreamStore
}) {
  const { connection } = React.useSyncExternalStore(
    streamStore.subscribe,
    streamStore.getSnapshot,
    streamStore.getSnapshot
  )
  const consoleAvailable = relayConnected && connection === "live"
  const selectObservedState = React.useMemo(
    () => selectInstanceObservedState(instance.id, instance.relayId),
    [instance.id, instance.relayId]
  )
  const { data: observedState } = useQuery({
    ...relaySnapshotQueryOptions(),
    select: selectObservedState,
  })
  const command = useConsoleCommand(
    instance.id,
    instance.relayId,
    active,
    consoleAvailable && observedState === "running"
  )

  return (
    <div className="shrink-0 border-t bg-background/80 px-3 py-3 sm:px-4">
      {canWrite ? (
        <form className="flex items-center gap-2" onSubmit={command.submit}>
          <span className="hidden font-mono text-xs font-semibold text-primary sm:inline">
            &gt;
          </span>
          <Popover
            open={Boolean(command.completions)}
            onOpenChange={(open) => {
              if (!open) command.stopCompletions()
            }}
          >
            <PopoverAnchor asChild>
              <div className="min-w-0 flex-1">
                <Input
                  ref={command.inputRef}
                  onChange={command.change}
                  onBlur={command.stopCompletions}
                  onKeyDown={command.keyDown}
                  placeholder={
                    !consoleAvailable
                      ? "Relay disconnected — commands paused"
                      : command.running
                        ? "Send a server command…"
                        : "Server is offline"
                  }
                  role="combobox"
                  aria-label="Server command"
                  aria-autocomplete="list"
                  aria-controls="console-command-completions"
                  aria-expanded={Boolean(command.completions)}
                  aria-invalid={Boolean(command.error)}
                  aria-keyshortcuts="Tab ArrowUp ArrowDown Escape"
                  aria-activedescendant={
                    command.completions?.status === "ready"
                      ? `console-completion-${command.completions.selectedIndex}`
                      : undefined
                  }
                  disabled={!command.running}
                  title={command.error ?? undefined}
                  autoFocus
                  autoComplete="off"
                  className="h-10 border-border/80 bg-card font-mono text-base shadow-none sm:text-xs"
                />
              </div>
            </PopoverAnchor>
            <PopoverContent
              ref={command.completionListRef}
              id="console-command-completions"
              role="listbox"
              align="start"
              side="top"
              sideOffset={7}
              className="max-h-[13.25rem] w-[var(--radix-popover-trigger-width)] min-w-64 overflow-y-scroll p-1 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/55 [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/75 [&::-webkit-scrollbar-track]:bg-foreground/10"
              style={{
                scrollbarColor:
                  "color-mix(in oklab, var(--muted-foreground) 55%, transparent) color-mix(in oklab, var(--foreground) 10%, transparent)",
                scrollbarGutter: "stable",
              }}
              aria-busy={command.completions?.status === "loading"}
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              {command.completions?.status === "loading" ? (
                <div
                  role="status"
                  className="flex items-center gap-2 px-2.5 py-2 font-mono text-xs text-muted-foreground"
                >
                  <LoaderCircle className="size-3.5 animate-spin text-primary/75" />
                  Waiting for completions…
                </div>
              ) : command.completions?.status === "empty" ? (
                <div
                  role="status"
                  className="px-2.5 py-2 font-mono text-xs text-muted-foreground"
                >
                  No completions
                </div>
              ) : command.completions?.status === "unavailable" ? (
                <div
                  role="status"
                  className="px-2.5 py-2 font-mono text-xs text-muted-foreground"
                >
                  Completions unavailable
                </div>
              ) : (
                command.completions?.suggestions.map((suggestion, index) => (
                  <button
                    id={`console-completion-${index}`}
                    role="option"
                    aria-selected={index === command.completions?.selectedIndex}
                    type="button"
                    key={suggestion.value}
                    className={`block w-full px-2.5 py-2 text-left font-mono text-xs ${
                      index === command.completions?.selectedIndex
                        ? "bg-popover-accent text-popover-accent-foreground"
                        : "text-muted-foreground hover:bg-muted/55 hover:text-foreground"
                    }`}
                    onMouseDown={(event) => event.preventDefault()}
                    onPointerMove={() => command.selectCompletion(index)}
                    onClick={() => command.applyCompletion(suggestion.value)}
                  >
                    {suggestion.label}
                  </button>
                ))
              )}
            </PopoverContent>
          </Popover>
          <Button
            ref={command.sendButtonRef}
            type="submit"
            size="sm"
            className="h-10 gap-1.5 px-4 text-xs"
            disabled={
              !command.running ||
              !command.inputRef.current?.value.trim() ||
              command.sending
            }
          >
            {command.sending ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <CornerDownLeft />
            )}
            Send
          </Button>
        </form>
      ) : (
        <div className="flex h-10 items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <EyeOff className="size-3.5" /> Read-only console access
        </div>
      )}
    </div>
  )
})

function useConsoleCommand(
  instanceId: string,
  relayId: string,
  active: boolean,
  running: boolean
) {
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [sending, setSending] = React.useState(false)
  const sendButtonRef = React.useRef<HTMLButtonElement>(null)
  const setValue = usePersistedCommand(
    instanceId,
    inputRef,
    sendButtonRef,
    running,
    sending
  )
  const { navigateHistory, recordCommand } = useCommandHistory(instanceId)
  const [completions, setCompletions] =
    React.useState<CommandCompletions | null>(null)
  const completionListRef = React.useRef<HTMLDivElement>(null)
  const completionSessionActive = React.useRef(false)
  const completionRequest = React.useRef(0)
  const completionPending = React.useRef({ cursor: -1, input: "" })
  const selectedCompletionIndex =
    completions?.status === "ready" ? completions.selectedIndex : null
  React.useEffect(() => {
    if (active) inputRef.current?.focus()
  }, [active, instanceId])

  React.useEffect(() => {
    if (selectedCompletionIndex === null) return
    let scrollFrame = 0
    const selectionFrame = window.requestAnimationFrame(() => {
      scrollFrame = window.requestAnimationFrame(() => {
        const selectedOption =
          completionListRef.current?.querySelector<HTMLElement>(
            `#console-completion-${selectedCompletionIndex}`
          )
        selectedOption?.scrollIntoView({ block: "nearest", inline: "nearest" })
      })
    })
    return () => {
      window.cancelAnimationFrame(selectionFrame)
      window.cancelAnimationFrame(scrollFrame)
    }
  }, [selectedCompletionIndex])

  function stopCompletions() {
    completionSessionActive.current = false
    completionRequest.current += 1
    completionPending.current = { cursor: -1, input: "" }
    setCompletions(null)
  }

  function applyCompletion(suggestion: string) {
    if (!completions || completions.status !== "ready") return
    const prefix = completions.input.slice(0, completions.cursor)
    const suffix = completions.input.slice(completions.cursor)
    const completedPrefix = mergeCommandCompletion(prefix, suggestion)
    setCompletions(null)
    setValue(`${completedPrefix}${suffix}`)
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(
        completedPrefix.length,
        completedPrefix.length
      )
    })
  }

  async function requestCompletion(
    input: string,
    cursor: number,
    activateSession = false
  ) {
    if (
      completionPending.current.input === input &&
      completionPending.current.cursor === cursor
    ) {
      return
    }
    const requestId = completionRequest.current + 1
    completionRequest.current = requestId
    completionPending.current = { cursor, input }
    setCompletions({
      cursor,
      input,
      selectedIndex: 0,
      status: "loading",
      suggestions: [],
    })
    try {
      const result = await completeRelayCommand({
        data: { instanceId, relayId, input, cursor },
      })
      if (completionRequest.current !== requestId) return
      if (!result.supported) {
        completionSessionActive.current = false
        setCompletions(null)
        return
      }
      if (activateSession) completionSessionActive.current = true

      const currentInput = inputRef.current
      if (!currentInput || currentInput.value !== input) {
        if (activateSession && currentInput) {
          void requestCompletion(
            currentInput.value,
            currentInput.selectionStart ?? currentInput.value.length
          )
        }
        return
      }
      const suggestionValues = [...result.suggestions]
      if (
        result.completedPrefix &&
        !suggestionValues.includes(result.completedPrefix)
      ) {
        suggestionValues.unshift(result.completedPrefix)
      }
      const prefix = input.slice(0, cursor)
      const suggestions = suggestionValues.map((suggestion) => ({
        label: commandCompletionLabel(prefix, suggestion),
        value: suggestion,
      }))
      setCompletions({
        cursor,
        input,
        selectedIndex: 0,
        status: suggestions.length > 0 ? "ready" : "empty",
        suggestions,
      })
    } catch {
      if (completionRequest.current === requestId) {
        if (activateSession) completionSessionActive.current = false
        setCompletions({
          cursor,
          input,
          selectedIndex: 0,
          status: "unavailable",
          suggestions: [],
        })
      }
    } finally {
      if (
        completionPending.current.input === input &&
        completionPending.current.cursor === cursor
      ) {
        completionPending.current = { cursor: -1, input: "" }
      }
    }
  }

  function navigate(event: React.KeyboardEvent<HTMLInputElement>) {
    if (
      (event.key !== "ArrowUp" && event.key !== "ArrowDown") ||
      event.nativeEvent.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return
    }
    const nextCommand = navigateHistory(
      event.key === "ArrowUp" ? "previous" : "next",
      event.currentTarget.value
    )
    if (nextCommand === undefined) return
    event.preventDefault()
    setCompletions(null)
    setValue(nextCommand)
    window.requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      input.setSelectionRange(input.value.length, input.value.length)
      if (completionSessionActive.current) {
        void requestCompletion(nextCommand, nextCommand.length)
      }
    })
  }

  function keyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (
      event.key === "Escape" &&
      (completionSessionActive.current || completions)
    ) {
      event.preventDefault()
      stopCompletions()
      return
    }
    if (completions?.status === "ready") {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const direction = event.key === "ArrowDown" ? 1 : -1
        setCompletions((current) =>
          current
            ? {
                ...current,
                selectedIndex: Math.min(
                  Math.max(current.selectedIndex + direction, 0),
                  current.suggestions.length - 1
                ),
              }
            : current
        )
        return
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault()
        const suggestion = completions.suggestions[completions.selectedIndex]
        applyCompletion(suggestion.value)
        return
      }
    }
    if (
      event.key === "Tab" &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      running
    ) {
      event.preventDefault()
      void requestCompletion(
        event.currentTarget.value,
        event.currentTarget.selectionStart ?? event.currentTarget.value.length,
        true
      )
      return
    }
    navigate(event)
  }

  function change(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget.value
    const cursor = event.currentTarget.selectionStart ?? input.length
    setError(null)
    setValue(input)
    if (completionSessionActive.current) {
      void requestCompletion(input, cursor)
    } else {
      setCompletions(null)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const command = inputRef.current?.value.trim() ?? ""
    if (!command || sending) return
    stopCompletions()
    recordCommand(command)
    setValue("")
    window.requestAnimationFrame(() => inputRef.current?.focus())
    setSending(true)
    try {
      await sendRelayCommand({
        data: { instanceId, relayId, command },
      })
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Command failed")
      setValue(command)
    } finally {
      setSending(false)
      window.requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  function selectCompletion(index: number) {
    setCompletions((current) =>
      current ? { ...current, selectedIndex: index } : current
    )
  }

  return {
    applyCompletion,
    change,
    completionListRef,
    completions,
    error,
    inputRef,
    keyDown,
    running,
    sendButtonRef,
    selectCompletion,
    sending,
    stopCompletions,
    submit,
  }
}

function ConsoleLevelFilter({
  active,
  level,
  label,
  onClick,
}: {
  active: boolean
  level?: RelayConsoleLevel
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2.5 px-2 py-2 text-left text-xs text-foreground transition-colors hover:bg-popover-accent/80 focus-visible:bg-popover-accent focus-visible:outline-none"
      aria-pressed={active}
      onClick={onClick}
    >
      <span
        className={`grid size-4 shrink-0 place-items-center border ${active ? "border-primary/45 bg-primary/12 text-primary" : "border-border bg-background text-transparent"}`}
      >
        <Check className="size-3" />
      </span>
      {level ? (
        <span
          className={`size-1.5 shrink-0 ${consoleLevelFilterTone(level)}`}
          aria-hidden="true"
        />
      ) : (
        <span
          className="size-1.5 shrink-0 bg-foreground/35"
          aria-hidden="true"
        />
      )}
      <span className="flex-1 capitalize">{label}</span>
    </button>
  )
}

function consoleLevelFilterTone(level: RelayConsoleLevel): string {
  if (level === "error") return "bg-red-400"
  if (level === "warn") return "bg-amber-400"
  if (level === "info") return "bg-sky-400"
  if (level === "debug") return "bg-emerald-400/90"
  return "bg-violet-400/90"
}

function shareTooltip(
  state: "idle" | "uploading" | "copied" | "error"
): string {
  if (state === "uploading") return "Uploading to mclo.gs"
  if (state === "copied") return "Link Copied"
  if (state === "error") return "Retry mclo.gs Upload"
  return "Upload to mclo.gs"
}

function shareLabel(state: "idle" | "uploading" | "copied" | "error"): string {
  if (state === "uploading") return "Uploading"
  if (state === "copied") return "Link copied"
  if (state === "error") return "Try again"
  return "mclo.gs"
}

function ConsoleTooltip({
  content,
  children,
}: {
  content: string
  children: React.ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

function lineTone(level: RelayConsoleLevel, selected: boolean): string {
  if (selected) return "border-primary bg-primary/10"
  if (level === "error")
    return "border-red-400/65 bg-red-500/7 hover:bg-red-500/12"
  if (level === "warn")
    return "border-amber-400/45 bg-amber-400/5 hover:bg-amber-400/10"
  return "border-transparent hover:bg-white/[0.025]"
}

function lineTextTone(level: RelayConsoleLevel): string {
  if (level === "error") return "text-red-200"
  if (level === "warn") return "text-amber-100"
  if (level === "debug" || level === "trace") return "text-muted-foreground"
  return "text-foreground/88"
}

function ConsoleTimestamp({ timestamp }: { timestamp: string | null }) {
  const formattedTimestamp = React.useSyncExternalStore(
    subscribeToBrowserLocale,
    () => formatTimestamp(timestamp),
    () => "--:--:--"
  )

  return (
    <span className="mr-2 ml-3 w-[3.25rem] shrink-0 text-[9px] text-muted-foreground/65 tabular-nums">
      {formattedTimestamp}
    </span>
  )
}

function subscribeToBrowserLocale(): () => void {
  // Locale has no browser change event; this store only defers formatting until hydration.
  return () => undefined
}

function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return "--:--:--"
  return consoleTimestampFormatter.format(new Date(timestamp))
}

function renderConsoleText(text: string, query: string): React.ReactNode {
  const redactedPattern = /(\*{3}(?:\.\*{3}){3}|(?=[*:]*\*)[*:]{2,})/gu
  let offset = 0
  return text.split(redactedPattern).map((part) => {
    const start = offset
    offset += part.length
    const isRedacted =
      /^\*{3}(?:\.\*{3}){3}$/u.test(part) || /^(?=[*:]*\*)[*:]{2,}$/u.test(part)

    if (isRedacted) {
      return (
        <span
          key={`redacted-${start}`}
          tabIndex={0}
          title="IP address redacted"
          aria-label="IP address redacted"
          className="cursor-help text-muted-foreground/75 transition-colors hover:text-foreground/85 focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          {part}
        </span>
      )
    }
    return (
      <React.Fragment key={`text-${start}`}>
        {renderConsoleSegment(part, query)}
      </React.Fragment>
    )
  })
}

function renderConsoleSegment(text: string, query: string): React.ReactNode {
  const urlPattern = /(https?:\/\/[^\s]+)/gu
  let offset = 0
  return text.split(urlPattern).map((part) => {
    const start = offset
    offset += part.length
    if (/^https?:\/\//u.test(part)) {
      return (
        <a
          key={`url-${start}`}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="text-sky-400 underline decoration-sky-400/30 underline-offset-2 hover:text-sky-300"
          onClick={(event) => event.stopPropagation()}
        >
          {part}
        </a>
      )
    }
    return (
      <React.Fragment key={`text-${start}`}>
        {highlightText(part, query)}
      </React.Fragment>
    )
  })
}

function highlightText(text: string, query: string): React.ReactNode {
  const normalized = query.trim()
  if (!normalized) return text
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const parts = text.split(new RegExp(`(${escaped})`, "giu"))
  let offset = 0
  return parts.map((part) => {
    const start = offset
    offset += part.length
    return part.toLowerCase() === normalized.toLowerCase() ? (
      <mark
        key={`match-${start}`}
        className="rounded-sm bg-amber-300 px-0.5 text-stone-950"
      >
        {part}
      </mark>
    ) : (
      <React.Fragment key={`text-${start}`}>{part}</React.Fragment>
    )
  })
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

function useRelayConsoleStream(
  relayId: string,
  instanceId: string,
  relayConnected: boolean
) {
  const queryClient = useQueryClient()
  const [consoleData, setConsoleData] = React.useState<RelayConsole | null>(
    () =>
      queryClient.getQueryData(queryKeys.relay.console(relayId, instanceId)) ??
      null
  )
  const [loading, setLoading] = React.useState(() => !consoleData)
  const [connection, setConnection] = React.useState<
    ConsoleStreamSnapshot["connection"]
  >(relayConnected ? "connecting" : "unavailable")

  React.useEffect(() => {
    if (!relayConnected) {
      setConnection("unavailable")
      setLoading(false)
      return
    }

    let cancelled = false
    const lifecycle = new AbortController()
    let activeIterator: ReturnType<typeof openRelayConsoleStream> | null = null
    let flushTimer: number | null = null
    const pending: Array<RelayConsoleLine> = []
    const seen = new Set(
      queryClient
        .getQueryData<RelayConsole>(
          queryKeys.relay.console(relayId, instanceId)
        )
        ?.lines.map((line) => line.id) ?? []
    )
    setConnection("connecting")
    setLoading(
      !queryClient.getQueryData(queryKeys.relay.console(relayId, instanceId))
    )

    function flush() {
      flushTimer = null
      if (cancelled || pending.length === 0) return
      const fresh = pending.splice(0).filter((line) => {
        if (seen.has(line.id)) return false
        seen.add(line.id)
        return true
      })
      if (fresh.length === 0) return
      setConsoleData((current) => {
        const next = {
          instanceId,
          lines: [...(current?.lines ?? []), ...fresh].slice(-5_000),
          truncated: Boolean(current?.truncated) || seen.size > 5_000,
        }
        queryClient.setQueryData(
          queryKeys.relay.console(relayId, instanceId),
          next
        )
        return next
      })
    }

    function append(line: RelayConsoleLine) {
      pending.push(line)
      if (pending.length >= 100) flush()
      else if (flushTimer === null) {
        flushTimer = window.setTimeout(flush, 40)
      }
    }

    async function connect() {
      let retryDelay = 400
      while (!cancelled) {
        try {
          const stream = openRelayConsoleStream(
            relayId,
            instanceId,
            lifecycle.signal
          )
          activeIterator = stream
          // Cancellation changes from the effect cleanup while next() awaits.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          while (!cancelled) {
            const result = await activeIterator.next()
            if (result.done) throw new Error("Console stream closed")
            if (result.value.type === "ready") {
              setLoading(false)
              setConnection("live")
              setConsoleData((current) => {
                const next = current ?? {
                  instanceId,
                  lines: [],
                  truncated: false,
                }
                queryClient.setQueryData(
                  queryKeys.relay.console(relayId, instanceId),
                  next
                )
                return next
              })
              retryDelay = 400
            } else {
              append(result.value.line)
            }
          }
        } catch {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (cancelled) break
          setLoading(false)
          setConnection("unavailable")
          await waitForRetry(retryDelay, lifecycle.signal)
          retryDelay = Math.min(retryDelay * 2, 5_000)
        }
      }
    }

    void connect()
    return () => {
      if (flushTimer !== null) window.clearTimeout(flushTimer)
      flush()
      cancelled = true
      lifecycle.abort()
      if (activeIterator) void activeIterator.return(undefined)
    }
  }, [instanceId, queryClient, relayConnected, relayId])

  return { connection, consoleData, loading }
}

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", cancel)
      resolve()
    }, delay)
    const cancel = () => {
      window.clearTimeout(timer)
      resolve()
    }
    signal.addEventListener("abort", cancel, { once: true })
  })
}

function usePersistedCommand(
  instanceId: string,
  inputRef: React.RefObject<HTMLInputElement | null>,
  sendButtonRef: React.RefObject<HTMLButtonElement | null>,
  running: boolean,
  sending: boolean
) {
  const storageKey = `hearth:console-draft:${instanceId}`

  const syncSubmitAvailability = React.useCallback(
    (value: string) => {
      if (sendButtonRef.current) {
        sendButtonRef.current.disabled = !running || sending || !value.trim()
      }
    },
    [running, sendButtonRef, sending]
  )

  React.useEffect(() => {
    const storedValue = window.sessionStorage.getItem(storageKey) ?? ""
    if (inputRef.current) inputRef.current.value = storedValue
  }, [inputRef, storageKey])

  React.useEffect(() => {
    syncSubmitAvailability(inputRef.current?.value ?? "")
  }, [inputRef, syncSubmitAvailability])

  const setValue = React.useCallback(
    (next: string) => {
      if (inputRef.current) inputRef.current.value = next
      syncSubmitAvailability(next)
      if (next) window.sessionStorage.setItem(storageKey, next)
      else window.sessionStorage.removeItem(storageKey)
    },
    [inputRef, storageKey, syncSubmitAvailability]
  )

  return setValue
}

const commandHistoryLimit = 100

function useCommandHistory(instanceId: string) {
  const storageKey = `kiln:console-history:${instanceId}`
  const history = React.useRef<Array<string>>([])
  const cursor = React.useRef<number | null>(null)
  const pendingDraft = React.useRef("")

  React.useEffect(() => {
    history.current = readCommandHistory(storageKey)
    cursor.current = null
    pendingDraft.current = ""
  }, [storageKey])

  const recordCommand = React.useCallback(
    (command: string) => {
      const current = history.current
      const next =
        current.at(-1) === command
          ? current
          : [...current, command].slice(-commandHistoryLimit)

      history.current = next
      cursor.current = null
      pendingDraft.current = ""
      window.sessionStorage.setItem(storageKey, JSON.stringify(next))
    },
    [storageKey]
  )

  const navigateHistory = React.useCallback(
    (
      direction: "previous" | "next",
      currentValue: string
    ): string | undefined => {
      const commands = history.current
      if (commands.length === 0) return undefined

      if (direction === "previous") {
        if (cursor.current === null) {
          pendingDraft.current = currentValue
          cursor.current = commands.length - 1
        } else {
          cursor.current = Math.max(0, cursor.current - 1)
        }
        return commands[cursor.current]
      }

      if (cursor.current === null) return undefined
      if (cursor.current < commands.length - 1) {
        cursor.current += 1
        return commands[cursor.current]
      }

      cursor.current = null
      return pendingDraft.current
    },
    []
  )

  return { navigateHistory, recordCommand }
}

function mergeCommandCompletion(prefix: string, suggestion: string): string {
  const { contextualStart, tokenStart } = commandCompletionContext(
    prefix,
    suggestion
  )
  if (contextualStart !== undefined) {
    return `${prefix.slice(0, contextualStart)}${suggestion}`
  }

  return `${prefix.slice(0, tokenStart)}${suggestion}`
}

function commandCompletionLabel(prefix: string, suggestion: string): string {
  const { contextualStart, tokenStart } = commandCompletionContext(
    prefix,
    suggestion
  )
  if (contextualStart === undefined) return suggestion

  const completedContext = prefix.slice(contextualStart, tokenStart)
  const label = suggestion.slice(completedContext.length)
  return label || suggestion
}

function commandCompletionContext(prefix: string, suggestion: string) {
  const tokenStarts = [0]
  for (let index = 1; index < prefix.length; index += 1) {
    if (
      /\s/u.test(prefix[index - 1] ?? "") &&
      !/\s/u.test(prefix[index] ?? "")
    ) {
      tokenStarts.push(index)
    }
  }

  const contextualStart = tokenStarts.find((start) => {
    const typedContext = prefix.slice(start)
    return typedContext.length > 0 && suggestion.startsWith(typedContext)
  })
  const tokenStart = /\s$/u.test(prefix)
    ? prefix.length
    : (tokenStarts.at(-1) ?? 0)
  return { contextualStart, tokenStart }
}

function readCommandHistory(storageKey: string): Array<string> {
  try {
    const stored: unknown = JSON.parse(
      window.sessionStorage.getItem(storageKey) ?? "[]"
    )
    if (!Array.isArray(stored)) return []
    return stored
      .filter(
        (command): command is string =>
          typeof command === "string" && command.length > 0
      )
      .slice(-commandHistoryLimit)
  } catch {
    return []
  }
}
