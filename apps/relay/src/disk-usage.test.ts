import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"

import { directoryApparentSizeEffect } from "./disk-usage.js"

describe("Relay disk usage", () => {
  it.effect("counts nested files once and ignores links", () =>
    withTemporaryDirectory((directory) =>
      Effect.gen(function* () {
        const nested = join(directory, "world")
        const data = join(nested, "data.bin")
        yield* fromPromise(() => mkdir(nested))
        yield* fromPromise(() => writeFile(data, "12345"))
        yield* fromPromise(() => writeFile(join(nested, "level.dat"), "1234"))
        yield* fromPromise(() => link(data, join(nested, "data-hardlink.bin")))
        yield* fromPromise(() => symlink(data, join(nested, "data-link.bin")))

        assert.strictEqual(yield* directoryApparentSizeEffect(directory), 9)
      })
    )
  )
})

function withTemporaryDirectory<T>(
  use: (directory: string) => Effect.Effect<T, unknown>
) {
  return Effect.acquireUseRelease(
    fromPromise(() => mkdtemp(join(tmpdir(), "kiln-relay-disk-usage-"))),
    use,
    (directory) =>
      fromPromise(() => rm(directory, { force: true, recursive: true })).pipe(
        Effect.orDie
      )
  )
}

function fromPromise<T>(run: () => Promise<T>) {
  return Effect.tryPromise(run)
}
