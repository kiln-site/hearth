import * as Sentry from "@sentry/tanstackstart-react"
import { Effect, ManagedRuntime } from "effect"

import type { Database } from "./database"
import { DatabaseLive } from "./database"

const runtime = ManagedRuntime.make(DatabaseLive)

export function runAppEffect<TResult, TError>(
  name: string,
  effect: Effect.Effect<TResult, TError, Database>
): Promise<TResult> {
  return Sentry.startSpan({ name, op: "kiln.effect" }, () =>
    runtime.runPromise(
      effect.pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            Sentry.captureException(error, {
              tags: { "kiln.effect": name },
            })
          })
        )
      )
    )
  )
}

export async function disposeAppRuntime(): Promise<void> {
  await runtime.dispose()
}
