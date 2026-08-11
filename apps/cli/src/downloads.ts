import { randomUUID } from "node:crypto"
import { open, rename, rm } from "node:fs/promises"

import { Effect } from "effect"

import { commandError } from "./errors.js"
import { publicResponseEffect } from "./http.js"

export const downloadBackupEffect = Effect.fn("cli.backups.download")(
  function* (input: { localPath: string; url: string }) {
    const bytes = yield* publicResponseEffect(
      input.url,
      { timeoutMs: null },
      (response) => {
        const body = response.body
        if (!body) {
          return commandError({
            code: "invalid_response",
            message: "The backup download did not include a response body.",
          })
        }
        const temporaryPath = `${input.localPath}.kiln-part-${randomUUID()}`
        const transfer = Effect.acquireUseRelease(
          Effect.tryPromise({
            try: () => open(temporaryPath, "wx"),
            catch: (cause) =>
              commandError({
                cause,
                code: "local_file_unavailable",
                exitCode: 2,
                message: `Could not create ${input.localPath}.`,
              }),
          }),
          (file) =>
            Effect.tryPromise({
              try: async () => {
                let bytes = 0
                for await (const chunk of body) {
                  let offset = 0
                  while (offset < chunk.byteLength) {
                    const result = await file.write(
                      chunk,
                      offset,
                      chunk.byteLength - offset
                    )
                    if (result.bytesWritten === 0) {
                      throw new Error("download_write_stalled")
                    }
                    offset += result.bytesWritten
                  }
                  bytes += chunk.byteLength
                }
                return bytes
              },
              catch: (cause) =>
                commandError({
                  cause,
                  code: "download_failed",
                  message: "The backup download failed.",
                  retryable: true,
                }),
            }),
          (file) => Effect.promise(() => file.close()).pipe(Effect.ignore)
        )
        return transfer.pipe(
          Effect.onError(() =>
            Effect.promise(() => rm(temporaryPath, { force: true })).pipe(
              Effect.ignore
            )
          ),
          Effect.flatMap((bytes) =>
            Effect.tryPromise({
              try: () => rename(temporaryPath, input.localPath),
              catch: (cause) =>
                commandError({
                  cause,
                  code: "local_file_unavailable",
                  exitCode: 2,
                  message: `Could not save ${input.localPath}.`,
                }),
            }).pipe(
              Effect.onError(() =>
                Effect.promise(() => rm(temporaryPath, { force: true })).pipe(
                  Effect.ignore
                )
              ),
              Effect.as(bytes)
            )
          )
        )
      }
    )
    return { bytes, localPath: input.localPath }
  }
)
