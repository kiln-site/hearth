import type {
  RelayConsoleLine,
  RelayConsoleStreamEvent,
} from "@workspace/contracts"
import { Effect } from "effect"

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

export function withFollowLogReader<TResult, TError, TRequirements>(
  body: ReadableStream<Uint8Array>,
  use: (
    reader: ReadableStreamDefaultReader<Uint8Array>
  ) => Effect.Effect<TResult, TError, TRequirements>
) {
  return Effect.acquireUseRelease(
    Effect.sync(() => body.getReader()),
    use,
    (reader) =>
      Effect.tryPromise({
        try: () => reader.cancel(),
        catch: () => undefined,
      }).pipe(Effect.ignore)
  )
}
