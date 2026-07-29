import type { RelayConsoleLine, RelayObservedState } from "@workspace/contracts"

export function initialConsoleStateLines(
  startedAt: string | null,
  state: RelayObservedState | undefined,
  readyAt: string | null = null
): Array<RelayConsoleLine> {
  if (!startedAt) return state ? [consoleStateLine(state, null)] : []

  const lines = [consoleStateLine("starting", startedAt)]
  if (state === "running") {
    lines.push(consoleStateLine("running", readyAt))
  } else if (
    state === "stopping" ||
    state === "stopped" ||
    state === "failed"
  ) {
    lines.push(consoleStateLine(state, null))
  }
  return lines
}

export function mergeConsoleStateLines(
  lines: ReadonlyArray<RelayConsoleLine>,
  startedAt: string | null,
  state: RelayObservedState | undefined,
  readyAt: string | null = null
): Array<RelayConsoleLine> {
  return [
    ...initialConsoleStateLines(startedAt, state, readyAt),
    ...lines,
  ].sort(compareConsoleLineOrder)
}

export function mergeConsoleHistory(
  current: ReadonlyArray<RelayConsoleLine>,
  history: ReadonlyArray<RelayConsoleLine>
): Array<RelayConsoleLine> {
  return [...current, ...history].sort(compareConsoleLineOrder)
}

export function consoleStateLine(
  state: RelayObservedState,
  timestamp: string | null
): RelayConsoleLine {
  const labels: Record<RelayObservedState, string> = {
    failed: "Server failed",
    stopped: "Server stopped",
    provisioning: "Server is provisioning",
    running: "Server is running",
    starting: "Server is starting",
    stopping: "Server is stopping",
  }
  const color =
    state === "failed"
      ? "#f87171"
      : state === "running"
        ? "#4ade80"
        : state === "stopping"
          ? "#fbbf24"
          : "#60a5fa"
  return {
    id: `kiln-state:${timestamp ?? "now"}:${state}`,
    timestamp,
    level: state === "failed" ? "error" : "info",
    text: labels[state],
    segments: [{ text: labels[state], color, bold: true }],
  }
}

export function isConsoleStateLine(line: Pick<RelayConsoleLine, "id">) {
  return line.id.startsWith("kiln-state:")
}

export function shouldRecordConsoleStateTransition(
  previous: RelayObservedState | undefined,
  next: RelayObservedState
) {
  if (previous === next) return false
  if (previous === "stopping" && next === "running") return false
  if (
    (previous === "stopped" || previous === "failed") &&
    (next === "running" || next === "stopping")
  ) {
    return false
  }
  return true
}

function compareConsoleLineOrder(
  left: RelayConsoleLine,
  right: RelayConsoleLine
): number {
  const leftTimestamp = consoleTimestamp(left.timestamp)
  const rightTimestamp = consoleTimestamp(right.timestamp)
  if (leftTimestamp !== rightTimestamp) return leftTimestamp - rightTimestamp
  return linePosition(left) - linePosition(right)
}

function consoleTimestamp(timestamp: string | null): number {
  if (timestamp === null) return Number.POSITIVE_INFINITY
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

function linePosition(line: RelayConsoleLine): number {
  if (line.id.endsWith(":starting")) return -1
  return isConsoleStateLine(line) ? 1 : 0
}
