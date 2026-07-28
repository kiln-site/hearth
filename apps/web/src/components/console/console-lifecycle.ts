import type { RelayConsoleLine, RelayObservedState } from "@workspace/contracts"

export function initialConsoleStateLines(
  startedAt: string | null,
  state: RelayObservedState | undefined
): Array<RelayConsoleLine> {
  if (!startedAt) return state ? [consoleStateLine(state, null)] : []

  const lines = [consoleStateLine("starting", startedAt)]
  if (state === "running") {
    lines.push(consoleStateLine("running", startedAt))
  } else if (
    state === "stopping" ||
    state === "stopped" ||
    state === "failed"
  ) {
    lines.push(consoleStateLine(state, null))
  }
  return lines
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
