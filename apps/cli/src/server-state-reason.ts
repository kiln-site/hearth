import type { RelayInstanceStateReason } from "@workspace/contracts"

export function formatServerStateReason(
  reason: RelayInstanceStateReason
): string {
  switch (reason.code) {
    case "waiting_for_readiness":
      return "Waiting for the configured server port to accept connections."
    case "health_check_starting":
      return "Docker health check is still starting."
    case "health_check_failed":
      return "Docker health check reported unhealthy."
    case "container_restarting":
      return "Docker is restarting the server container."
    case "out_of_memory":
      return "The server was stopped by an out-of-memory kill."
    case "process_exit":
      return `The server process exited with code ${reason.exitCode}.`
    case "automatic_recovery":
      return formatAutomaticRecoveryReason(reason)
    case "unknown":
      return "Relay could not determine why the server failed."
  }
}

function formatAutomaticRecoveryReason(
  reason: Extract<RelayInstanceStateReason, { code: "automatic_recovery" }>
): string {
  const phase =
    reason.phase === "pending"
      ? "is scheduled"
      : reason.phase === "restarting"
        ? "is restarting the server"
        : "stopped after exhausting its attempts"
  const cause =
    reason.reason === "out_of_memory"
      ? "an out-of-memory kill"
      : reason.reason === "start_failed"
        ? "a failed restart attempt"
        : reason.reason === "clean_exit"
          ? "a clean process exit"
          : reason.exitCode === null
            ? "a process exit"
            : `process exit code ${reason.exitCode}`
  return `Automatic recovery ${phase} after ${cause}.`
}
