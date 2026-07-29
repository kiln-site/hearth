import * as Sentry from "@sentry/tanstackstart-react"
import { Effect } from "effect"

import { deleteInstanceAccessEffect } from "@/lib/access-control"
import { invalidateRelayCache, relayCachePolicy } from "@/lib/relay-client"

export const finalizeInstanceDeletionEffect = Effect.fn(
  "instances.delete.finalize"
)(function* (relayId: string, instanceId: string) {
  yield* postDeleteCleanupStep(
    "relay.snapshot.invalidate",
    relayId,
    instanceId,
    invalidateRelayCache(relayCachePolicy.snapshot(relayId))
  )
  yield* postDeleteCleanupStep(
    "access.deleteInstance",
    relayId,
    instanceId,
    deleteInstanceAccessEffect(relayId, instanceId)
  )
})

function postDeleteCleanupStep<TError, TRequirements>(
  operation: string,
  relayId: string,
  instanceId: string,
  cleanup: Effect.Effect<unknown, TError, TRequirements>
) {
  return cleanup.pipe(
    Effect.asVoid,
    Effect.catch((error) =>
      reportPostDeleteCleanupFailureEffect(
        operation,
        relayId,
        instanceId,
        error
      )
    )
  )
}

const reportPostDeleteCleanupFailureEffect = Effect.fn(
  "instances.delete.reportCleanupFailure"
)(function* (
  operation: string,
  relayId: string,
  instanceId: string,
  error: unknown
) {
  yield* Effect.try({
    try: () => {
      Sentry.captureException(error, {
        tags: {
          "kiln.instance_id": instanceId,
          "kiln.operation": operation,
          "kiln.relay_id": relayId,
        },
      })
    },
    catch: () => undefined,
  }).pipe(Effect.catch(() => Effect.void))
  yield* Effect.logWarning(
    "Post-delete Hearth cleanup failed after Relay removed the server",
    {
      error: error instanceof Error ? error.message : String(error),
      instanceId,
      operation,
      relayId,
    }
  )
})
