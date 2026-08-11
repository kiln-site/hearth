import type { RelayControlError } from "@workspace/contracts"

import { RelayUnavailableError } from "@/effect/errors"

export function relayControlFailureError(
  error: RelayControlError
): RelayUnavailableError {
  return RelayUnavailableError.make({
    code: error.code,
    message: error.message,
    ...(error.replyTo ? { requestId: error.replyTo } : {}),
    retryable: error.retryable,
  })
}
