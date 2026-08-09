import { createFileRoute } from "@tanstack/react-router"
import { cliDeviceTokenRequestSchema } from "@workspace/contracts"
import { Effect } from "effect"

import { pollCliDeviceTokenEffect } from "@/effect/cli-access"
import { CliAccessError } from "@/effect/errors"
import { runAppEffect } from "@/effect/runtime"
import { cliFailureResponse, cliJsonResponse } from "@/lib/cli-http"

export const Route = createFileRoute("/api/cli/auth/token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const effect = Effect.tryPromise({
          try: () => request.json(),
          catch: (cause) => invalidBody(cause),
        }).pipe(
          Effect.flatMap((body) =>
            Effect.try({
              try: () => cliDeviceTokenRequestSchema.parse(body),
              catch: invalidBody,
            })
          ),
          Effect.flatMap((input) => pollCliDeviceTokenEffect(input.deviceCode)),
          Effect.match({
            onFailure: cliFailureResponse,
            onSuccess: (value) => cliJsonResponse(value),
          })
        )
        return runAppEffect("cli.http.device.poll", effect)
      },
    },
  },
})

function invalidBody(cause: unknown) {
  return CliAccessError.make({
    code: "invalid_request",
    message: "A valid deviceCode is required.",
    retryable: false,
    cause,
  })
}
