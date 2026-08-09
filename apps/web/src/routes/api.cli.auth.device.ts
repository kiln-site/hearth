import { createFileRoute } from "@tanstack/react-router"
import { cliDeviceCodeRequestSchema } from "@workspace/contracts"
import { Effect } from "effect"

import { issueCliDeviceCodeEffect } from "@/effect/cli-access"
import { CliAccessError } from "@/effect/errors"
import { runAppEffect } from "@/effect/runtime"
import { cliFailureResponse, cliJsonResponse } from "@/lib/cli-http"
import { kilnPublicUrl } from "@/lib/environment"

export const Route = createFileRoute("/api/cli/auth/device")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const effect = Effect.tryPromise({
          try: () => request.json(),
          catch: (cause) =>
            CliAccessError.make({
              code: "invalid_request",
              message: "The request body must be valid JSON.",
              retryable: false,
              cause,
            }),
        }).pipe(
          Effect.flatMap((body) =>
            Effect.try({
              try: () => cliDeviceCodeRequestSchema.parse(body),
              catch: (cause) =>
                CliAccessError.make({
                  code: "invalid_request",
                  message: "A CLI name is required.",
                  retryable: false,
                  cause,
                }),
            })
          ),
          Effect.flatMap((input) =>
            issueCliDeviceCodeEffect({
              baseUrl: kilnPublicUrl(),
              ipAddress: requestIp(request.headers),
              name: input.name,
              userAgent: request.headers.get("user-agent"),
            })
          ),
          Effect.match({
            onFailure: cliFailureResponse,
            onSuccess: (value) => cliJsonResponse(value, 201),
          })
        )
        return runAppEffect("cli.http.device.issue", effect)
      },
    },
  },
})

function requestIp(headers: Headers): string | null {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    null
  )
}
