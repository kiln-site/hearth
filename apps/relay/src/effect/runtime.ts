import * as Sentry from "@sentry/node"
import { Layer, ManagedRuntime } from "effect"
import type { Effect } from "effect"

const runtime = ManagedRuntime.make(Layer.empty)

export function runRelayEffect<TResult, TError>(
  name: string,
  effect: Effect.Effect<TResult, TError>
): Promise<TResult> {
  return Sentry.startSpan({ name, op: "kiln.effect" }, () =>
    runtime.runPromise(effect)
  )
}

export async function disposeRelayRuntime(): Promise<void> {
  await runtime.dispose()
}
