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

interface CommandCompletions {
  cursor: number
  input: string
  selectedIndex: number
  status: "empty" | "loading" | "ready" | "unavailable"
  suggestions: Array<string>
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
  const [consoleData, setConsoleData] = React.useState<RelayConsole | null>(
    null
  )
  const [query, setQuery] = React.useState("")
  const [levels, setLevels] = React.useState<Set<RelayConsoleLevel>>(
    () => new Set(LEVELS)
  )
  const [showTimestamps, setShowTimestamps] = React.useState(false)
  const [redactSensitive, setRedactSensitive] = React.useState(true)
  const [wrapLines, setWrapLines] = React.useState(true)
  const [autoScroll, setAutoScroll] = React.useState(true)
  const [, setConnectionState] = React.useState<
    "connecting" | "live" | "reconnecting"
  >("connecting")
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set())
  const [lastSelected, setLastSelected] = React.useState<number | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [commandError, setCommandError] = React.useState<string | null>(null)
  const [command, setCommand] = usePersistedCommand(instance.id)
  const { navigateHistory, recordCommand } = useCommandHistory(instance.id)
  const [sending, setSending] = React.useState(false)
  const [commandCompletions, setCommandCompletions] =
    React.useState<CommandCompletions | null>(null)
  const [copyState, setCopyState] = React.useState<"idle" | "copied">("idle")
  const [shareState, setShareState] = React.useState<
    "idle" | "uploading" | "copied" | "error"
  >("idle")
  const parentRef = React.useRef<HTMLDivElement>(null)
  const commandInputRef = React.useRef<HTMLInputElement>(null)
  const completionListRef = React.useRef<HTMLDivElement>(null)
  const copyTimer = React.useRef<number | null>(null)
  const shareTimer = React.useRef<number | null>(null)
  const completionSessionActive = React.useRef(false)
  const completionRequest = React.useRef(0)
  const completionPending = React.useRef<{
    cursor: number
    input: string
  }>({ cursor: -1, input: "" })
  const programmaticScroll = React.useRef(false)
  const selectedCompletionIndex =
    commandCompletions?.status === "ready"
      ? commandCompletions.selectedIndex
      : null

  React.useEffect(() => {
    let cancelled = false
    const lifecycle = new AbortController()
    let activeIterator: ReturnType<typeof openRelayConsoleStream> | null = null
    let flushTimer: number | null = null
    const pending: Array<RelayConsoleLine> = []
    const seen = new Set<string>()

    setConsoleData(null)
    setSelected(new Set())
    setLastSelected(null)
    setLoading(true)
    setConnectionState("connecting")

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
        instanceId: instance.id,
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
          setConnectionState((current) =>
            current === "connecting" ? "connecting" : "reconnecting"
          )
          const stream = openRelayConsoleStream(instance.id, lifecycle.signal)
          activeIterator = stream
          // Cancellation changes from the effect cleanup while next() awaits.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          while (!cancelled) {
            const result = await activeIterator.next()
            if (result.done) throw new Error("Console stream closed")
            if (result.value.type === "ready") {
              setLoading(false)
              setConnectionState("live")
              setConsoleData(
                (current) =>
                  current ?? {
                    instanceId: instance.id,
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
          setConnectionState("reconnecting")
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
  }, [instance.id])

  React.useEffect(() => {
    if (active) commandInputRef.current?.focus()
  }, [active, instance.id])

  React.useEffect(() => {
    completionSessionActive.current = false
    completionRequest.current += 1
    completionPending.current = { cursor: -1, input: "" }
    setCommandCompletions(null)
  }, [instance.id])

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

  React.useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
      if (shareTimer.current) window.clearTimeout(shareTimer.current)
    },
    []
  )

  const clearSelection = React.useCallback(() => {
    setSelected(new Set())
    setLastSelected(null)
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
    return [...(consoleData?.lines ?? [])]
      .map((line) => ({
        ...line,
        text: redactSensitive ? redactSensitiveText(line.text) : line.text,
      }))
      .filter(
        (line) =>
          levels.has(line.level) &&
          (!normalizedQuery ||
            line.text.toLowerCase().includes(normalizedQuery))
      )
  }, [consoleData?.lines, levels, query, redactSensitive])

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
    if (!active) return
    rowVirtualizer.measure()
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

  function toggleLine(line: RelayConsoleLine, index: number, shift: boolean) {
    setCopyState("idle")
    setSelected((current) => {
      const next = new Set(current)
      if (shift && lastSelected !== null) {
        const start = Math.min(lastSelected, index)
        const end = Math.max(lastSelected, index)
        for (let cursor = start; cursor <= end; cursor++) {
          const selectedLine = filteredLines.at(cursor)
          if (selectedLine) next.add(selectedLine.id)
        }
      } else if (next.has(line.id)) next.delete(line.id)
      else next.add(line.id)
      return next
    })
    setLastSelected(index)
  }

  async function copySelected() {
    const lines = filteredLines
      .filter((line) => selected.has(line.id))
      .map((line) => line.text)
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

  function navigateCommandHistory(
    event: React.KeyboardEvent<HTMLInputElement>
  ) {
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
    setCommandCompletions(null)
    setCommand(nextCommand)
    window.requestAnimationFrame(() => {
      const input = commandInputRef.current
      if (!input) return
      input.setSelectionRange(input.value.length, input.value.length)
      if (completionSessionActive.current) {
        void requestCommandCompletion(nextCommand, nextCommand.length)
      }
    })
  }

  function stopCommandCompletions() {
    completionSessionActive.current = false
    completionRequest.current += 1
    completionPending.current = { cursor: -1, input: "" }
    setCommandCompletions(null)
  }

  function applyCommandCompletion(suggestion: string) {
    if (!commandCompletions || commandCompletions.status !== "ready") return
    const prefix = commandCompletions.input.slice(0, commandCompletions.cursor)
    const suffix = commandCompletions.input.slice(commandCompletions.cursor)
    const tokenStart = Math.max(prefix.lastIndexOf(" ") + 1, 0)
    const completedPrefix = suggestion.startsWith(prefix.slice(0, tokenStart))
      ? suggestion
      : `${prefix.slice(0, tokenStart)}${suggestion}`
    setCommandCompletions(null)
    setCommand(`${completedPrefix}${suffix}`)
    window.requestAnimationFrame(() => {
      const input = commandInputRef.current
      input?.focus()
      input?.setSelectionRange(completedPrefix.length, completedPrefix.length)
    })
  }

  async function requestCommandCompletion(
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
    setCommandCompletions({
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
        setCommandCompletions(null)
        return
      }
      if (activateSession) completionSessionActive.current = true

      const currentInput = commandInputRef.current
      if (!currentInput || currentInput.value !== input) {
        if (activateSession && currentInput) {
          void requestCommandCompletion(
            currentInput.value,
            currentInput.selectionStart ?? currentInput.value.length
          )
        }
        return
      }
      const suggestions = [...result.suggestions]
      if (
        result.completedPrefix &&
        !suggestions.includes(result.completedPrefix)
      ) {
        suggestions.unshift(result.completedPrefix)
      }
      setCommandCompletions({
        cursor,
        input,
        selectedIndex: 0,
        status: suggestions.length > 0 ? "ready" : "empty",
        suggestions,
      })
    } catch {
      if (completionRequest.current === requestId) {
        if (activateSession) completionSessionActive.current = false
        setCommandCompletions({
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

  function handleCommandKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return

    if (
      event.key === "Escape" &&
      (completionSessionActive.current || commandCompletions)
    ) {
      event.preventDefault()
      stopCommandCompletions()
      return
    }

    if (commandCompletions?.status === "ready") {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const direction = event.key === "ArrowDown" ? 1 : -1
        setCommandCompletions((current) => {
          if (!current) return current
          return {
            ...current,
            selectedIndex: Math.min(
              Math.max(current.selectedIndex + direction, 0),
              current.suggestions.length - 1
            ),
          }
        })
        return
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault()
        const suggestion =
          commandCompletions.suggestions[commandCompletions.selectedIndex]
        if (suggestion) applyCommandCompletion(suggestion)
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
      void requestCommandCompletion(
        event.currentTarget.value,
        event.currentTarget.selectionStart ?? event.currentTarget.value.length,
        true
      )
      return
    }

    navigateCommandHistory(event)
  }

  async function submitCommand(event: React.FormEvent) {
    event.preventDefault()
    const value = command.trim()
    if (!value || sending) return
    stopCommandCompletions()
    recordCommand(value)
    setCommand("")
    window.requestAnimationFrame(() => commandInputRef.current?.focus())
    setSending(true)

    try {
      await sendRelayCommand({
        data: { instanceId: instance.id, command: value },
      })
      setCommandError(null)
    } catch (cause) {
      setCommandError(cause instanceof Error ? cause.message : "Command failed")
      setCommand(value)
    } finally {
      setSending(false)
      window.requestAnimationFrame(() => commandInputRef.current?.focus())
    }
  }

  const allLevels = levels.size === LEVELS.length
  const running = instance.observedState === "running"

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-card">
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
          <ConsoleTooltip
            content={
              allLevels
                ? "Filter console output by log level."
                : `Showing ${levels.size} of ${LEVELS.length} log levels.`
            }
          >
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
          <ConsoleTooltip
            content={
              redactSensitive
                ? "Upload the redacted latest.log to mclo.gs and copy its link."
                : "Upload latest.log to mclo.gs and copy its link."
            }
          >
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
              disabled={
                shareState === "uploading" || !consoleData?.lines.length
              }
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
              {shareState === "uploading"
                ? "Uploading"
                : shareState === "copied"
                  ? "Link copied"
                  : shareState === "error"
                    ? "Try again"
                    : "mclo.gs"}
            </Button>
          </ConsoleTooltip>
          <Popover open={selected.size > 0}>
            <PopoverAnchor asChild>
              <span className="inline-flex">
                <ConsoleTooltip
                  content={
                    selected.size > 0
                      ? `Copy ${selected.size} selected ${selected.size === 1 ? "line" : "lines"}.`
                      : "Select console lines to copy."
                  }
                >
                  <Button
                    variant={copyState === "copied" ? "secondary" : "ghost"}
                    size="icon"
                    className="size-8"
                    aria-label={
                      selected.size > 0
                        ? `Copy ${selected.size} selected ${selected.size === 1 ? "line" : "lines"}`
                        : "Copy selected console lines"
                    }
                    disabled={selected.size === 0}
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
                  ? `${selected.size} ${selected.size === 1 ? "line" : "lines"} copied`
                  : `${selected.size} ${selected.size === 1 ? "line" : "lines"} selected`}
              </span>
              <ConsoleTooltip content="Clear selection (Esc).">
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
          <ConsoleTooltip content="Hide IP addresses in the console, copied lines, and mclo.gs uploads.">
            <Button
              variant={redactSensitive ? "secondary" : "ghost"}
              size="icon"
              className="size-8"
              aria-label={
                redactSensitive ? "Disable IP redaction" : "Enable IP redaction"
              }
              aria-pressed={redactSensitive}
              onClick={() => setRedactSensitive((value) => !value)}
            >
              <EyeOff />
            </Button>
          </ConsoleTooltip>
          {canShare ? (
            <ConsoleTooltip
              content={
                wrapLines
                  ? "Keep long console lines on one row."
                  : "Wrap long console lines to the available width."
              }
            >
              <Button
                variant={wrapLines ? "secondary" : "ghost"}
                size="icon"
                className="size-8"
                aria-label={
                  wrapLines ? "Disable text wrapping" : "Enable text wrapping"
                }
                aria-pressed={wrapLines}
                onClick={() => setWrapLines((value) => !value)}
              >
                <WrapText />
              </Button>
            </ConsoleTooltip>
          ) : null}
          <ConsoleTooltip
            content={
              showTimestamps
                ? "Hide timestamps from console rows."
                : "Show the timestamp for each console row."
            }
          >
            <Button
              variant={showTimestamps ? "secondary" : "ghost"}
              size="icon"
              className="size-8"
              aria-label={
                showTimestamps ? "Hide timestamps" : "Show timestamps"
              }
              onClick={() => setShowTimestamps((value) => !value)}
            >
              <Clock3 />
            </Button>
          </ConsoleTooltip>
        </div>
      </div>

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
                    <span className="mr-2 ml-3 w-[3.25rem] shrink-0 text-[9px] text-muted-foreground/65 tabular-nums">
                      {formatTimestamp(line.timestamp)}
                    </span>
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

      <div className="shrink-0 border-t bg-background/80 px-3 py-3 sm:px-4">
        {canWrite ? (
          <form className="flex items-center gap-2" onSubmit={submitCommand}>
            <span className="hidden font-mono text-xs font-semibold text-primary sm:inline">
              &gt;
            </span>
            <Popover
              open={Boolean(commandCompletions)}
              onOpenChange={(open) => {
                if (!open) stopCommandCompletions()
              }}
            >
              <PopoverAnchor asChild>
                <div className="min-w-0 flex-1">
                  <Input
                    ref={commandInputRef}
                    value={command}
                    onChange={(event) => {
                      const input = event.currentTarget.value
                      const cursor =
                        event.currentTarget.selectionStart ?? input.length
                      setCommandError(null)
                      setCommand(input)
                      if (completionSessionActive.current) {
                        void requestCommandCompletion(input, cursor)
                      } else {
                        setCommandCompletions(null)
                      }
                    }}
                    onBlur={stopCommandCompletions}
                    onKeyDown={handleCommandKeyDown}
                    placeholder={
                      running ? "Send a server command…" : "Server is offline"
                    }
                    role="combobox"
                    aria-label="Server command"
                    aria-autocomplete="list"
                    aria-controls="console-command-completions"
                    aria-expanded={Boolean(commandCompletions)}
                    aria-invalid={Boolean(commandError)}
                    aria-keyshortcuts="Tab ArrowUp ArrowDown Escape"
                    aria-activedescendant={
                      commandCompletions?.status === "ready"
                        ? `console-completion-${commandCompletions.selectedIndex}`
                        : undefined
                    }
                    disabled={!running}
                    title={commandError ?? undefined}
                    autoFocus
                    autoComplete="off"
                    className="h-10 border-border/80 bg-card font-mono text-xs shadow-none"
                  />
                </div>
              </PopoverAnchor>
              <PopoverContent
                ref={completionListRef}
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
                aria-busy={commandCompletions?.status === "loading"}
                onOpenAutoFocus={(event) => event.preventDefault()}
                onCloseAutoFocus={(event) => event.preventDefault()}
              >
                {commandCompletions?.status === "loading" ? (
                  <div
                    role="status"
                    className="flex items-center gap-2 px-2.5 py-2 font-mono text-xs text-muted-foreground"
                  >
                    <LoaderCircle className="size-3.5 animate-spin text-primary/75" />
                    Waiting for completions…
                  </div>
                ) : commandCompletions?.status === "empty" ? (
                  <div
                    role="status"
                    className="px-2.5 py-2 font-mono text-xs text-muted-foreground"
                  >
                    No completions
                  </div>
                ) : commandCompletions?.status === "unavailable" ? (
                  <div
                    role="status"
                    className="px-2.5 py-2 font-mono text-xs text-muted-foreground"
                  >
                    Completions unavailable
                  </div>
                ) : (
                  commandCompletions?.suggestions.map((suggestion, index) => (
                    <button
                      id={`console-completion-${index}`}
                      role="option"
                      aria-selected={index === commandCompletions.selectedIndex}
                      type="button"
                      key={suggestion}
                      className={`block w-full px-2.5 py-2 text-left font-mono text-xs ${
                        index === commandCompletions.selectedIndex
                          ? "bg-popover-accent text-popover-accent-foreground"
                          : "text-muted-foreground hover:bg-muted/55 hover:text-foreground"
                      }`}
                      onMouseDown={(event) => event.preventDefault()}
                      onPointerMove={() =>
                        setCommandCompletions((current) =>
                          current
                            ? { ...current, selectedIndex: index }
                            : current
                        )
                      }
                      onClick={() => applyCommandCompletion(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))
                )}
              </PopoverContent>
            </Popover>
            <Button
              type="submit"
              size="sm"
              className="h-10 gap-1.5 px-4 text-xs"
              disabled={!running || !command.trim() || sending}
            >
              {sending ? (
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
    </section>
  )
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

function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return "--:--:--"
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp))
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
