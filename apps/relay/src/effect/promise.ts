import { Effect } from "effect"

export function promiseEffect<TResult>(
  run: () => PromiseLike<TResult>
): Effect.Effect<TResult, unknown> {
  return Effect.tryPromise({ try: run, catch: (cause) => cause })
}

export function recoverPromise<TResult, TFallback>(
  run: () => PromiseLike<TResult>,
  recover: (cause: unknown) => TFallback
): Promise<TResult | TFallback> {
  return Effect.runPromise(
    promiseEffect(run).pipe(
      Effect.catch((cause) =>
        Effect.try({ try: () => recover(cause), catch: (error) => error })
      )
    )
  )
}

export function tapPromiseError<TResult>(
  run: () => PromiseLike<TResult>,
  onError: (cause: unknown) => void
): Promise<TResult> {
  return Effect.runPromise(
    promiseEffect(run).pipe(
      Effect.tapError((cause) =>
        Effect.try({ try: () => onError(cause), catch: (error) => error })
      )
    )
  )
}

export function forkPromise(
  run: () => PromiseLike<unknown>,
  onError: (cause: unknown) => void = () => undefined
): void {
  Effect.runFork(
    promiseEffect(run).pipe(
      Effect.catch((cause) =>
        Effect.try({ try: () => onError(cause), catch: () => undefined })
      )
    )
  )
}

export function ensuringPromise<TResult>(
  run: () => PromiseLike<TResult>,
  finalizer: () => void
): Promise<TResult> {
  return Effect.runPromise(
    promiseEffect(run).pipe(
      Effect.ensuring(
        Effect.try({ try: finalizer, catch: (cause) => cause }).pipe(
          Effect.orDie
        )
      )
    )
  )
}
