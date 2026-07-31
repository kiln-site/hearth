import { lstat, opendir, stat } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Option } from "effect"

export const directoryApparentSizeEffect = Effect.fn(
  "RelayDiskUsage.directoryApparentSize"
)(function* (root: string) {
  const rootMetadata = yield* fsOperation(() => stat(root))
  const rootDevice = rootMetadata.dev
  const hardLinks = new Set<string>()

  const visit = Effect.fn("RelayDiskUsage.visit")(function* (
    directory: string
  ): Effect.fn.Return<number, unknown> {
    const opened = yield* fsOperation(() => opendir(directory)).pipe(
      Effect.map(Option.some),
      Effect.catchIf(isMissingPath, () => Effect.succeed(Option.none()))
    )
    if (Option.isNone(opened)) return 0

    return yield* Effect.acquireUseRelease(
      Effect.succeed(opened.value),
      (entries) =>
        Effect.gen(function* () {
          let total = 0
          while (true) {
            const entry = yield* fsOperation(() => entries.read())
            if (!entry) return total

            const path = join(directory, entry.name)
            if (entry.isSymbolicLink()) continue
            if (entry.isDirectory()) {
              const metadata = yield* metadataOrNone(path)
              if (
                Option.isSome(metadata) &&
                metadata.value.dev === rootDevice
              ) {
                total += yield* visit(path)
              }
              continue
            }
            if (!entry.isFile()) continue

            const metadata = yield* metadataOrNone(path)
            if (Option.isNone(metadata) || metadata.value.dev !== rootDevice) {
              continue
            }
            if (metadata.value.nlink > 1) {
              const key = `${metadata.value.dev}:${metadata.value.ino}`
              if (hardLinks.has(key)) continue
              hardLinks.add(key)
            }
            total += metadata.value.size
          }
        }),
      (entries) => fsOperation(() => entries.close())
    )
  })

  return yield* visit(root)
})

export function directoryApparentSize(root: string): Promise<number> {
  return Effect.runPromise(directoryApparentSizeEffect(root))
}

function metadataOrNone(path: string) {
  return fsOperation(() => lstat(path)).pipe(
    Effect.map(Option.some),
    Effect.catchIf(isMissingPath, () => Effect.succeed(Option.none()))
  )
}

function fsOperation<A>(run: () => Promise<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => cause,
  })
}

function isMissingPath(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    "code" in cause &&
    (cause.code === "ENOENT" || cause.code === "ENOTDIR")
  )
}
