import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"

import { RelayRemoteFileError } from "./effect/errors.js"
import { withRemoteFileSource } from "./remote-file-source.js"

describe("Relay remote file sources", () => {
  it.effect("requires HTTPS without embedded credentials", () =>
    Effect.gen(function* () {
      const insecure = yield* withRemoteFileSource(
        "http://example.com/example.jar",
        () => Effect.void
      ).pipe(Effect.flip)
      assert.instanceOf(insecure, RelayRemoteFileError)
      assert.strictEqual(insecure.code, "insecure_remote_source")

      const credentials = yield* withRemoteFileSource(
        "https://user:password@example.com/example.jar",
        () => Effect.void
      ).pipe(Effect.flip)
      assert.instanceOf(credentials, RelayRemoteFileError)
      assert.strictEqual(credentials.code, "remote_credentials_forbidden")
      assert.strictEqual(credentials.source, "https://example.com/example.jar")
    })
  )

  it.effect(
    "rejects literal private and metadata addresses before connecting",
    () =>
      Effect.gen(function* () {
        for (const source of [
          "https://127.0.0.1/file.jar",
          "https://10.0.0.1/file.jar",
          "https://169.254.169.254/latest/meta-data",
          "https://[::1]/file.jar",
          "https://[::ffff:7f00:1]/file.jar",
        ]) {
          const failure = yield* withRemoteFileSource(
            source,
            () => Effect.void
          ).pipe(Effect.flip)
          assert.instanceOf(failure, RelayRemoteFileError)
          assert.strictEqual(failure.code, "blocked_remote_address")
        }
      })
  )
})
