import * as Sentry from "@sentry/tanstackstart-react"
import { wrapFetchWithSentry } from "@sentry/tanstackstart-react"
import { createStartHandler } from "@tanstack/react-start/server"
import { createServerEntry } from "@tanstack/react-start/server-entry"

import { hearthStreamHandler } from "./app-server-handler"
import { disposeAppRuntime } from "./effect/runtime"

const handleStartRequest = createStartHandler(hearthStreamHandler)

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
      return handleStartRequest(request)
    },
  })
)
