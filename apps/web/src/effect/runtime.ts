import * as Sentry from "@sentry/tanstackstart-react"
import { Layer, ManagedRuntime } from "effect"
import type { Effect } from "effect"

import type { AppCache } from "./cache"
import { AppCacheLive } from "./cache"
import type { Database } from "./database"
import { DatabaseLive } from "./database"

const AppLive = Layer.mergeAll(DatabaseLive, AppCacheLive)
const runtime = ManagedRuntime.make(AppLive)

export function runAppEffect<TResult, TError>(
  name: string,
  effect: Effect.Effect<TResult, TError, AppCache | Database>
): Promise<TResult> {
  return Sentry.startSpan({ name, op: "kiln.effect" }, () =>
    runtime.runPromise(effect)
  )
}

export async function disposeAppRuntime(): Promise<void> {
  await runtime.dispose()
}
