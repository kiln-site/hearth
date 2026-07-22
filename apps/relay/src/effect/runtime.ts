import * as Sentry from "@sentry/node"
import { ManagedRuntime } from "effect"
import type { Effect } from "effect"

import { makeRelayStateLayer, RelayStateStore } from "./state.js"
import type { RelayConfig } from "../config.js"

let runtime: ManagedRuntime.ManagedRuntime<RelayStateStore, unknown> | null =
  null

export function initializeRelayRuntime(config: RelayConfig): void {
  if (runtime) return
  runtime = ManagedRuntime.make(
    makeRelayStateLayer(`${config.dataDirectory}/network/relay.sqlite`)
  )
}

export function runRelayEffect<TResult, TError>(
  name: string,
  effect: Effect.Effect<TResult, TError, RelayStateStore>
): Promise<TResult> {
  if (!runtime) {
    throw new Error("Relay Effect runtime has not been initialized")
  }
  const activeRuntime = runtime
  return Sentry.startSpan({ name, op: "kiln.effect" }, () =>
    activeRuntime.runPromise(effect)
  )
}

export async function disposeRelayRuntime(): Promise<void> {
  await runtime?.dispose()
  runtime = null
}
