if (import.meta.env.DEV) {
  await import("../instrument.server.mjs")
}

import * as Sentry from "@sentry/tanstackstart-react"
import { wrapFetchWithSentry } from "@sentry/tanstackstart-react"
import handler, { createServerEntry } from "@tanstack/react-start/server-entry"

import { disposeAppRuntime } from "./effect/runtime"

let shutdownPromise: Promise<void> | undefined

export function shutdownHearth(): Promise<void> {
  shutdownPromise ??= Promise.all([
    disposeAppRuntime(),
    Sentry.close(2_000),
  ]).then(() => undefined)
  return shutdownPromise
}

export default createServerEntry(
  wrapFetchWithSentry({
    fetch(request: Request) {
      return handler.fetch(request)
    },
  })
)
