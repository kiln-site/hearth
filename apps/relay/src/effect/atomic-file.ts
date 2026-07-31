import { open, rename, unlink } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { Effect } from "effect"

export function writeFileAtomic(
  path: string,
  value: string,
  mode: number
): Effect.Effect<void, unknown> {
  const temporaryPath = join(dirname(path), `.${randomUUID()}.tmp`)
  let renamed = false

  return Effect.gen(function* () {
    yield* Effect.acquireUseRelease(
      Effect.tryPromise(() => open(temporaryPath, "wx", mode)),
      (file) =>
        Effect.tryPromise(async () => {
          await file.writeFile(value, "utf8")
          await file.sync()
        }),
      (file) => Effect.tryPromise(() => file.close())
    )

    yield* Effect.tryPromise(() => rename(temporaryPath, path))
    renamed = true

    yield* Effect.acquireUseRelease(
      Effect.tryPromise(() => open(dirname(path), "r")),
      (directory) => Effect.tryPromise(() => directory.sync()),
      (directory) => Effect.tryPromise(() => directory.close())
    )
  }).pipe(
    Effect.onExit(() =>
      renamed
        ? Effect.void
        : Effect.tryPromise(() => unlink(temporaryPath)).pipe(Effect.ignore)
    ),
    Effect.uninterruptible
  )
}
