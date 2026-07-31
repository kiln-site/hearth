import { Effect } from "effect"

import { promiseEffect } from "@/effect/promise"

export function enqueueAppearancePersistence(
  pending: Promise<void>,
  persist: () => Promise<unknown>
): Promise<void> {
  return Effect.runPromise(
    promiseEffect(() => pending).pipe(
      Effect.ignore,
      Effect.andThen(promiseEffect(persist)),
      Effect.ignore
    )
  )
}
