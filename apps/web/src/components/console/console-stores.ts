import type {
  RelayConsole,
  RelayConsoleLevel,
  RelayConsoleLine,
} from "@workspace/contracts"

export const consoleLevels: Array<RelayConsoleLevel> = [
  "info",
  "warn",
  "error",
  "debug",
  "trace",
]

export interface ConsoleFilterSnapshot {
  levels: Set<RelayConsoleLevel>
  query: string
  redactSensitive: boolean
}

export interface ConsoleUiStore {
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

export interface ConsoleStreamSnapshot {
  connection: "connecting" | "live" | "unavailable"
  consoleData: RelayConsole | null
  loading: boolean
}

export interface ConsoleStreamStore {
  getHasLinesSnapshot: () => boolean
  getSnapshot: () => ConsoleStreamSnapshot
  setSnapshot: (snapshot: ConsoleStreamSnapshot) => void
  subscribe: (listener: () => void) => () => void
}

export function createConsoleStreamStore(): ConsoleStreamStore {
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

export function createConsoleUiStore(): ConsoleUiStore {
  let query = ""
  let levels = new Set(consoleLevels)
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
        levels = new Set(consoleLevels)
      } else if (levels.size === consoleLevels.length) {
        levels = new Set([level])
      } else {
        const next = new Set(levels)
        if (next.has(level) && next.size === 1) {
          levels = new Set(consoleLevels)
        } else {
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
