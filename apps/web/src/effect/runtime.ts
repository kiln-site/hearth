import * as Sentry from "@sentry/tanstackstart-react"
import { ManagedRuntime } from "effect"
import type { Effect } from "effect"

import type { Database } from "./database"
import { DatabaseLive } from "./database"

const runtime = ManagedRuntime.make(DatabaseLive)

export function runAppEffect<TResult, TError>(
  name: string,
  effect: Effect.Effect<TResult, TError, Database>
): Promise<TResult> {
  return Sentry.startSpan({ name, op: "kiln.effect" }, () =>
    runtime.runPromise(effect)
  )
}

export async function disposeAppRuntime(): Promise<void> {
  await runtime.dispose()
}
