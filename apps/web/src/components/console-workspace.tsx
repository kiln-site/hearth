import * as React from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type {
  RelayConsole,
  RelayConsoleLevel,
  RelayConsoleLine,
  RelayInstance,
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

export function ConsoleWorkspace({
  instance,
  active,
  canShare,
  canWrite,
}: {
  instance: RelayInstance
  active: boolean
  canShare: boolean
  canWrite: boolean
}) {
  return (
    <ConsoleWorkspaceSession
      key={instance.id}
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
  instance: RelayInstance
  active: boolean
  canShare: boolean
  canWrite: boolean
}) {
  const { consoleData, loading } = useRelayConsoleStream(instance.id)
  const [query, setQuery] = React.useState("")
  const [levels, setLevels] = React.useState<Set<RelayConsoleLevel>>(
    () => new Set(LEVELS)
  )
  const [showTimestamps, setShowTimestamps] = React.useState(false)
  const [redactSensitive, setRedactSensitive] = React.useState(true)
  const [wrapLines, setWrapLines] = React.useState(true)
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set())
  const [copyState, setCopyState] = React.useState<"idle" | "copied">("idle")
  const [shareState, setShareState] = React.useState<
    "idle" | "uploading" | "copied" | "error"
  >("idle")
  const copyTimer = React.useRef<number | null>(null)
  const shareTimer = React.useRef<number | null>(null)
  const lastSelected = React.useRef<number | null>(null)

  React.useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
      if (shareTimer.current) window.clearTimeout(shareTimer.current)
    },
    []
  )

  const clearSelection = React.useCallback(() => {
    setSelected(new Set())
    lastSelected.current = null
    setCopyState("idle")
  }, [])

  React.useEffect(() => {
    if (!active || selected.size === 0) return

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") clearSelection()
    }

    window.addEventListener("keydown", handleEscape, { capture: true })
    return () => window.removeEventListener("keydown", handleEscape, true)
  }, [active, clearSelection, selected.size])

  const filteredLines = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const filtered: Array<RelayConsoleLine> = []
    for (const line of consoleData?.lines ?? []) {
      const text = redactSensitive ? redactSensitiveText(line.text) : line.text
      if (
        levels.has(line.level) &&
        (!normalizedQuery || text.toLowerCase().includes(normalizedQuery))
      ) {
        filtered.push({ ...line, text })
      }
    }
    return filtered
  }, [consoleData?.lines, levels, query, redactSensitive])

  function toggleLevel(level: RelayConsoleLevel | "all") {
    if (level === "all") {
      setLevels(new Set(LEVELS))
      return
    }
    setLevels((current) => {
      if (current.size === LEVELS.length) return new Set([level])
      const next = new Set(current)
      if (next.has(level) && next.size === 1) return new Set(LEVELS)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }

  async function copySelected() {
    const lines: Array<string> = []
    for (const line of filteredLines) {
      if (selected.has(line.id)) lines.push(line.text)
    }
    await copyToClipboard(lines.join("\n"))
    setCopyState("copied")
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopyState("idle"), 1_800)
  }

  async function shareLatestLog() {
    setShareState("uploading")
    try {
      const result = await uploadLatestLogToMclogs({
        data: {
          instanceId: instance.id,
          implementation: instance.implementation,
          version: instance.version,
          redactSensitive,
        },
      })
      await copyToClipboard(result.url)
      setShareState("copied")
    } catch {
      setShareState("error")
    }
    if (shareTimer.current) window.clearTimeout(shareTimer.current)
    shareTimer.current = window.setTimeout(() => setShareState("idle"), 2_800)
  }

  const allLevels = levels.size === LEVELS.length

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-card">
      <ConsoleToolbar
        allLevels={allLevels}
        canShare={canShare}
        clearSelection={clearSelection}
        consoleData={consoleData}
        copySelected={copySelected}
        copyState={copyState}
        levels={levels}
        query={query}
        redactSensitive={redactSensitive}
        selectedCount={selected.size}
        setQuery={setQuery}
        setRedactSensitive={setRedactSensitive}
        setShowTimestamps={setShowTimestamps}
        setWrapLines={setWrapLines}
        shareLatestLog={shareLatestLog}
        shareState={shareState}
        showTimestamps={showTimestamps}
        toggleLevel={toggleLevel}
        wrapLines={wrapLines}
      />
      <ConsoleLogViewport
        active={active}
        consoleData={consoleData}
        filteredLines={filteredLines}
        lastSelected={lastSelected}
        loading={loading}
        query={query}
        selected={selected}
        setCopyState={setCopyState}
        setSelected={setSelected}
        showTimestamps={showTimestamps}
        wrapLines={wrapLines}
      />

      <ConsoleCommandBar
        active={active}
        canWrite={canWrite}
        instance={instance}
      />
    </section>
  )
}

interface ConsoleToolbarProps {
  allLevels: boolean
  canShare: boolean
  clearSelection: () => void
  consoleData: RelayConsole | null
  copySelected: () => Promise<void>
  copyState: "idle" | "copied"
  levels: Set<RelayConsoleLevel>
  query: string
  redactSensitive: boolean
  selectedCount: number
  setQuery: React.Dispatch<React.SetStateAction<string>>
  setRedactSensitive: React.Dispatch<React.SetStateAction<boolean>>
  setShowTimestamps: React.Dispatch<React.SetStateAction<boolean>>
  setWrapLines: React.Dispatch<React.SetStateAction<boolean>>
  shareLatestLog: () => Promise<void>
  shareState: "idle" | "uploading" | "copied" | "error"
  showTimestamps: boolean
  toggleLevel: (level: RelayConsoleLevel | "all") => void
  wrapLines: boolean
}

function ConsoleToolbar({
  allLevels,
  canShare,
  clearSelection,
  consoleData,
  copySelected,
  copyState,
  levels,
  query,
  redactSensitive,
  selectedCount,
  setQuery,
  setRedactSensitive,
  setShowTimestamps,
  setWrapLines,
  shareLatestLog,
  shareState,
  showTimestamps,
  toggleLevel,
  wrapLines,
}: ConsoleToolbarProps) {
  return (
    <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2.5 sm:px-4">
      <div className="relative min-w-[12rem] flex-1 sm:max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search console"
          aria-label="Search console"
          className="h-9 border-border/80 bg-background pl-8 text-xs shadow-none"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear console search"
            className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setQuery("")}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
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
            onClick={() => toggleLevel("all")}
          />
          <div className="my-1 border-t" />
          {LEVELS.map((level) => (
            <ConsoleLevelFilter
              key={level}
              active={levels.has(level)}
              level={level}
              label={level}
              onClick={() => toggleLevel(level)}
            />
          ))}
        </PopoverContent>
      </Popover>
      <div className="ml-auto flex items-center gap-1.5">
        <ConsoleTooltip content={shareTooltip(shareState)}>
          <Button
            variant={
              shareState === "copied"
                ? "secondary"
                : shareState === "error"
                  ? "destructive"
                  : "ghost"
            }
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-[11px]"
            disabled={shareState === "uploading" || !consoleData?.lines.length}
            onClick={shareLatestLog}
          >
            {shareState === "uploading" ? (
              <LoaderCircle className="animate-spin" />
            ) : shareState === "copied" ? (
              <Check />
            ) : shareState === "error" ? (
              <TriangleAlert />
            ) : (
              <Share2 />
            )}
            {shareLabel(shareState)}
          </Button>
        </ConsoleTooltip>
        <Popover open={selectedCount > 0}>
          <PopoverAnchor asChild>
            <span className="inline-flex">
              <ConsoleTooltip
                content={
                  copyState === "copied"
                    ? "Selected Lines Copied"
                    : "Copy Selected Lines"
                }
              >
                <Button
                  variant={copyState === "copied" ? "secondary" : "ghost"}
                  size="icon"
                  className="size-8"
                  aria-label={
                    selectedCount > 0
                      ? `Copy ${selectedCount} Selected ${selectedCount === 1 ? "Line" : "Lines"}`
                      : "Copy Selected Lines"
                  }
                  disabled={selectedCount === 0}
                  onClick={copySelected}
                >
                  {copyState === "copied" ? <Check /> : <Copy />}
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
            onEscapeKeyDown={clearSelection}
          >
            <span
              className="font-mono text-[10px] whitespace-nowrap text-muted-foreground"
              aria-live="polite"
            >
              {copyState === "copied"
                ? `${selectedCount} ${selectedCount === 1 ? "line" : "lines"} copied`
                : `${selectedCount} ${selectedCount === 1 ? "line" : "lines"} selected`}
            </span>
            <ConsoleTooltip content="Clear Selection">
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Clear selected console lines"
                onClick={clearSelection}
              >
                <X className="size-3.5" />
              </Button>
            </ConsoleTooltip>
          </PopoverContent>
        </Popover>
        <ConsoleTooltip content={redactSensitive ? "Show IPs" : "Censor IPs"}>
          <Button
            variant={redactSensitive ? "secondary" : "ghost"}
            size="icon"
            className="size-8"
            aria-label={redactSensitive ? "Show IPs" : "Censor IPs"}
            aria-pressed={redactSensitive}
            onClick={() => setRedactSensitive((value) => !value)}
          >
            <EyeOff />
          </Button>
        </ConsoleTooltip>
        {canShare ? (
          <ConsoleTooltip
            content={wrapLines ? "Disable Line Wrap" : "Enable Line Wrap"}
          >
            <Button
              variant={wrapLines ? "secondary" : "ghost"}
              size="icon"
              className="size-8"
              aria-label={wrapLines ? "Disable Line Wrap" : "Enable Line Wrap"}
              aria-pressed={wrapLines}
              onClick={() => setWrapLines((value) => !value)}
            >
              <WrapText />
            </Button>
          </ConsoleTooltip>
        ) : null}
        <ConsoleTooltip
          content={showTimestamps ? "Hide Timestamps" : "Show Timestamps"}
        >
          <Button
            variant={showTimestamps ? "secondary" : "ghost"}
            size="icon"
            className="size-8"
            aria-label={showTimestamps ? "Hide timestamps" : "Show timestamps"}
            onClick={() => setShowTimestamps((value) => !value)}
          >
            <Clock3 />
          </Button>
        </ConsoleTooltip>
      </div>
    </div>
  )
}

interface ConsoleLogViewportProps {
  active: boolean
  consoleData: RelayConsole | null
  filteredLines: Array<RelayConsoleLine>
  lastSelected: React.RefObject<number | null>
  loading: boolean
  query: string
  selected: Set<string>
  setCopyState: React.Dispatch<React.SetStateAction<"idle" | "copied">>
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>
  showTimestamps: boolean
  wrapLines: boolean
}

function ConsoleLogViewport({
  active,
  consoleData,
  filteredLines,
  lastSelected,
  loading,
  query,
  selected,
  setCopyState,
  setSelected,
  showTimestamps,
  wrapLines,
}: ConsoleLogViewportProps) {
  const [autoScroll, setAutoScroll] = React.useState(true)
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

  function toggleLine(line: RelayConsoleLine, index: number, shift: boolean) {
    setCopyState("idle")
    setSelected((current) => {
      const next = new Set(current)
      if (shift && lastSelected.current !== null) {
        const start = Math.min(lastSelected.current, index)
        const end = Math.max(lastSelected.current, index)
        for (let cursor = start; cursor <= end; cursor++) {
          const selectedLine = filteredLines.at(cursor)
          if (selectedLine) next.add(selectedLine.id)
        }
      } else if (next.has(line.id)) next.delete(line.id)
      else next.add(line.id)
      return next
    })
    lastSelected.current = index
  }

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
            const isSelected = selected.has(line.id)
            return (
              <div
                role="button"
                tabIndex={0}
                key={line.id}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                className={`absolute left-0 flex min-h-[30px] border-l-2 pr-5 text-left transition-colors ${wrapLines ? "w-full items-start py-1.5 whitespace-pre-wrap" : "h-[30px] min-w-full items-center whitespace-nowrap"} ${lineTone(line.level, isSelected)}`}
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                  width: wrapLines ? "100%" : "max(100%, max-content)",
                }}
                onClick={(event) =>
                  toggleLine(line, virtualRow.index, event.shiftKey)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    toggleLine(line, virtualRow.index, event.shiftKey)
                  }
                }}
              >
                {showTimestamps ? (
                  <ConsoleTimestamp timestamp={line.timestamp} />
                ) : null}
                <span
                  className={`min-w-0 flex-1 leading-[18px] ${wrapLines ? "break-words" : ""} ${showTimestamps ? "" : "ml-3"} ${lineTextTone(line.level)}`}
                >
                  {renderConsoleText(line.text, query)}
                </span>
              </div>
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

      {loading && !consoleData ? (
        <div className="absolute inset-0 grid place-items-center bg-card/70 backdrop-blur-[2px]">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin text-primary" />
            Opening live console stream
          </div>
        </div>
      ) : null}
      {!loading && filteredLines.length === 0 ? (
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

function ConsoleCommandBar({
  active,
  canWrite,
  instance,
}: {
  active: boolean
  canWrite: boolean
  instance: RelayInstance
}) {
  const command = useConsoleCommand(instance, active)

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
                  value={command.value}
                  onChange={command.change}
                  onBlur={command.stopCompletions}
                  onKeyDown={command.keyDown}
                  placeholder={
                    command.running
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
            type="submit"
            size="sm"
            className="h-10 gap-1.5 px-4 text-xs"
            disabled={
              !command.running || !command.value.trim() || command.sending
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
}

function useConsoleCommand(instance: RelayInstance, active: boolean) {
  const [error, setError] = React.useState<string | null>(null)
  const [value, setValue] = usePersistedCommand(instance.id)
  const { navigateHistory, recordCommand } = useCommandHistory(instance.id)
  const [sending, setSending] = React.useState(false)
  const [completions, setCompletions] =
    React.useState<CommandCompletions | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const completionListRef = React.useRef<HTMLDivElement>(null)
  const completionSessionActive = React.useRef(false)
  const completionRequest = React.useRef(0)
  const completionPending = React.useRef({ cursor: -1, input: "" })
  const selectedCompletionIndex =
    completions?.status === "ready" ? completions.selectedIndex : null
  const running = instance.observedState === "running"

  React.useEffect(() => {
    if (active) inputRef.current?.focus()
  }, [active, instance.id])

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
        data: { instanceId: instance.id, input, cursor },
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
    const command = value.trim()
    if (!command || sending) return
    stopCompletions()
    recordCommand(command)
    setValue("")
    window.requestAnimationFrame(() => inputRef.current?.focus())
    setSending(true)
    try {
      await sendRelayCommand({
        data: { instanceId: instance.id, command },
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
    selectCompletion,
    sending,
    stopCompletions,
    submit,
    value,
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
  return text.split(redactedPattern).map((part, index) => {
    const isRedacted =
      /^\*{3}(?:\.\*{3}){3}$/u.test(part) || /^(?=[*:]*\*)[*:]{2,}$/u.test(part)

    if (isRedacted) {
      return (
        <Tooltip key={`${part}-${index}`}>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="cursor-help text-muted-foreground/75 transition-colors hover:text-foreground/85 focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              {part}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            IP address redacted
          </TooltipContent>
        </Tooltip>
      )
    }
    return (
      <React.Fragment key={index}>
        {renderConsoleSegment(part, query)}
      </React.Fragment>
    )
  })
}

function renderConsoleSegment(text: string, query: string): React.ReactNode {
  const urlPattern = /(https?:\/\/[^\s]+)/gu
  return text.split(urlPattern).map((part, index) => {
    if (/^https?:\/\//u.test(part)) {
      return (
        <a
          key={`${part}-${index}`}
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
      <React.Fragment key={index}>{highlightText(part, query)}</React.Fragment>
    )
  })
}

function highlightText(text: string, query: string): React.ReactNode {
  const normalized = query.trim()
  if (!normalized) return text
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const parts = text.split(new RegExp(`(${escaped})`, "giu"))
  return parts.map((part, index) =>
    part.toLowerCase() === normalized.toLowerCase() ? (
      <mark
        key={index}
        className="rounded-sm bg-amber-300 px-0.5 text-stone-950"
      >
        {part}
      </mark>
    ) : (
      <React.Fragment key={index}>{part}</React.Fragment>
    )
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

function useRelayConsoleStream(instanceId: string) {
  const [consoleData, setConsoleData] = React.useState<RelayConsole | null>(
    null
  )
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    const lifecycle = new AbortController()
    let activeIterator: ReturnType<typeof openRelayConsoleStream> | null = null
    let flushTimer: number | null = null
    const pending: Array<RelayConsoleLine> = []
    const seen = new Set<string>()

    function flush() {
      flushTimer = null
      if (cancelled || pending.length === 0) return
      const fresh = pending.splice(0).filter((line) => {
        if (seen.has(line.id)) return false
        seen.add(line.id)
        return true
      })
      if (fresh.length === 0) return
      setConsoleData((current) => ({
        instanceId,
        lines: [...(current?.lines ?? []), ...fresh].slice(-5_000),
        truncated: Boolean(current?.truncated) || seen.size > 5_000,
      }))
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
          const stream = openRelayConsoleStream(instanceId, lifecycle.signal)
          activeIterator = stream
          // Cancellation changes from the effect cleanup while next() awaits.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          while (!cancelled) {
            const result = await activeIterator.next()
            if (result.done) throw new Error("Console stream closed")
            if (result.value.type === "ready") {
              setLoading(false)
              setConsoleData(
                (current) =>
                  current ?? {
                    instanceId,
                    lines: [],
                    truncated: false,
                  }
              )
              retryDelay = 400
            } else {
              append(result.value.line)
            }
          }
        } catch {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (cancelled) break
          setLoading(false)
          await waitForRetry(retryDelay, lifecycle.signal)
          retryDelay = Math.min(retryDelay * 2, 5_000)
        }
      }
    }

    void connect()
    return () => {
      cancelled = true
      lifecycle.abort()
      if (flushTimer !== null) window.clearTimeout(flushTimer)
      if (activeIterator) void activeIterator.return(undefined)
    }
  }, [instanceId])

  return { consoleData, loading }
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

function usePersistedCommand(instanceId: string) {
  const storageKey = `hearth:console-draft:${instanceId}`
  const [value, setValueState] = React.useState("")

  React.useEffect(() => {
    setValueState(window.sessionStorage.getItem(storageKey) ?? "")
  }, [storageKey])

  const setValue = React.useCallback(
    (next: string) => {
      setValueState(next)
      if (next) window.sessionStorage.setItem(storageKey, next)
      else window.sessionStorage.removeItem(storageKey)
    },
    [storageKey]
  )

  return [value, setValue] as const
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
