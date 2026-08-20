import { Effect, Schema } from "effect"

import { ExternalServiceError } from "@/effect/errors"

const headers = {
  Accept: "application/json",
  "User-Agent": "kiln-hearth",
}

export const listMcJarVersionsEffect = Effect.fn("mcjarfiles.versions")(
  function* (type: string, variant: string) {
    const versions = yield* requestJson(
      `https://mcjarfiles.com/api/get-versions/${encodeURIComponent(type)}/${encodeURIComponent(variant)}`,
      Schema.Array(Schema.String)
    )
    return {
      versions: [
        ...new Set(versions.map((version) => version.trim()).filter(Boolean)),
      ],
    }
  }
)

function requestJson<TValue>(
  url: string,
  schema: Schema.Decoder<TValue>
): Effect.Effect<TValue, ExternalServiceError> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        throw new Error(`mcjarfiles returned HTTP ${response.status}`)
      }
      return Schema.decodeUnknownSync(schema)(await response.json())
    },
    catch: (cause) =>
      ExternalServiceError.make({
        cause,
        message:
          cause instanceof Error
            ? cause.message
            : "mcjarfiles returned an invalid response",
        service: "mcjarfiles",
      }),
  })
}
