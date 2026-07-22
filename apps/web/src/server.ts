import * as Sentry from "@sentry/tanstackstart-react"
import { wrapFetchWithSentry } from "@sentry/tanstackstart-react"
import { createStartHandler } from "@tanstack/react-start/server"
import { createServerEntry } from "@tanstack/react-start/server-entry"

import { hearthStreamHandler } from "./app-server-handler"
import { disposeAppRuntime } from "./effect/runtime"
import {
  initializeRelayFromEnvironment,
  maintainPersistedRelayConnections,
} from "./lib/relay-registry"

try {
  const relay = await initializeRelayFromEnvironment()
  if (relay) console.log(`Automatically paired Relay ${relay.name}`)
  void maintainPersistedRelayConnections().catch((cause) => {
    Sentry.captureException(cause, {
      tags: { "kiln.operation": "relay.connection.maintain" },
    })
  })
} catch (cause) {
  Sentry.captureException(cause, {
    tags: { "kiln.operation": "relay.bootstrap" },
  })
  console.warn("Automatic Relay pairing did not complete:", cause)
}

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
