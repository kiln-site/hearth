import type { CliPowerResponse } from "@workspace/contracts"

const powerActionLabels: Record<CliPowerResponse["action"], string> = {
  kill: "Kill",
  restart: "Restart",
  start: "Start",
  stop: "Stop",
}

export function formatPowerResponse(result: CliPowerResponse): string {
  const state = result.instance.observedState
  const desired = result.instance.desiredState
  const stateDescription =
    state === desired ? state : `${state} (desired ${desired})`

  return `${powerActionLabels[result.action]} requested for ${result.instance.name}. State: ${stateDescription}.`
}
