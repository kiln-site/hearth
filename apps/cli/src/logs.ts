import type {
  RelayConsoleLine,
  RelayConsoleStreamEvent,
} from "@workspace/contracts"

export interface FollowLogOutput {
  initialLines: ReadonlyArray<RelayConsoleLine>
  liveLine: (event: RelayConsoleStreamEvent) => RelayConsoleLine | undefined
}

export function prepareFollowLogOutput(
  history: ReadonlyArray<RelayConsoleLine>,
  limit: number
): FollowLogOutput {
  const initialLines = history.slice(-limit)
  const initialLineIds = new Set(initialLines.map((line) => line.id))

  return {
    initialLines,
    liveLine: (event) => {
      if (event.type !== "line" || initialLineIds.has(event.line.id)) {
        return undefined
      }
      return event.line
    },
  }
}
