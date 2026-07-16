import * as Sentry from "@sentry/node"
import { Effect, Layer, ManagedRuntime } from "effect"

const runtime = ManagedRuntime.make(Layer.empty)

export function runRelayEffect<TResult, TError>(
  name: string,
  effect: Effect.Effect<TResult, TError>
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

export async function disposeRelayRuntime(): Promise<void> {
  await runtime.dispose()
}
