import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import type { FileHandle } from "node:fs/promises"
import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Fiber } from "effect"

import { loadConfig } from "./config.js"
import { FilesystemDriver, MAX_TRANSFER_BYTES } from "./files.js"
import { RelayFilesystemError } from "./effect/errors.js"
import type { RelayInstanceConfig } from "./config.js"

const describeLinux = process.platform === "linux" ? describe : describe.skip

describeLinux("Relay direct file transfers", () => {
  it.effect("renames, duplicates, archives, and deletes entries", () =>
    withSetup(({ driver, instance, root }) =>
      Effect.gen(function* () {
        yield* fromPromise(() =>
          writeFile(resolve(root, "world", "data.txt"), "settings")
        )
        yield* driver.mutate(instance, {
          operation: "rename",
          path: "world/data.txt",
          destination: "world/server.txt",
        })
        yield* driver.mutate(instance, {
          operation: "duplicate",
          paths: ["world/server.txt"],
        })
        const archived = yield* driver.mutate(instance, {
          operation: "archive",
          paths: ["world/server.txt", "world/server copy.txt"],
          destination: "world/configs.zip",
        })
        assert.include(archived.paths, "world/configs.zip")
        assert.strictEqual(archived.sizes["world/server.txt"], 8)
        assert.isAtLeast(archived.sizes["world/"] ?? 0, 16)
        assert.strictEqual(archived.sizes[""], archived.sizes["world/"])
        assert.isAbove(archived.modifiedAt["world/server.txt"] ?? 0, 0)
        assert.isAbove(archived.modifiedAt["world/"] ?? 0, 0)
        const archive = yield* fromPromise(() =>
          readFile(resolve(root, "world", "configs.zip"))
        )
        assert.strictEqual(archive.subarray(0, 2).toString(), "PK")

        const deleted = yield* driver.mutate(instance, {
          operation: "delete",
          paths: ["world/server.txt", "world/server copy.txt"],
        })
        assert.notInclude(deleted.paths, "world/server.txt")
        assert.notInclude(deleted.paths, "world/server copy.txt")
      })
    )
  )

  it.effect("atomically uploads and reads through a pinned file handle", () =>
    withSetup(({ driver, instance, root }) =>
      Effect.gen(function* () {
        const uploaded = yield* driver.upload(
          instance,
          "world/data.txt",
          chunks("direct transfer")
        )
        assert.strictEqual(uploaded.size, 15)
        assert.lengthOf(uploaded.sha256, 64)

        const contents = yield* driver.withDownload(
          instance,
          "world/data.txt",
          (download) =>
            fromPromise(async () => {
              assert.strictEqual(download.size, 15)
              return download.file.readFile("utf8")
            })
        )
        assert.strictEqual(contents, "direct transfer")
        assert.isNotEmpty(root)
      })
    )
  )

  it.effect("refuses a final symlink for transfers and file actions", () =>
    withSetup(({ directory, driver, instance, root }) =>
      Effect.gen(function* () {
        const outside = resolve(directory, "outside.txt")
        yield* fromPromise(() => writeFile(outside, "sensitive"))
        yield* fromPromise(() =>
          symlink(outside, resolve(root, "world", "escape.txt"))
        )

        const downloadFailure = yield* driver
          .withDownload(instance, "world/escape.txt", () => Effect.void)
          .pipe(Effect.flip)
        assert.instanceOf(downloadFailure, RelayFilesystemError)

        const uploadFailure = yield* driver
          .upload(instance, "world/escape.txt", chunks("overwrite"))
          .pipe(Effect.flip)
        assert.instanceOf(uploadFailure, RelayFilesystemError)
        assert.strictEqual(uploadFailure.code, "not_a_file")

        const mutationFailure = yield* driver
          .mutate(instance, {
            operation: "duplicate",
            paths: ["world/escape.txt"],
          })
          .pipe(Effect.flip)
        assert.instanceOf(mutationFailure, RelayFilesystemError)
        assert.strictEqual(mutationFailure.code, "unsupported_file")
      })
    )
  )

  it.effect("closes downloads and removes failed upload temporaries", () =>
    withSetup(({ driver, instance, root }) =>
      Effect.gen(function* () {
        yield* driver.upload(instance, "world/data.txt", chunks("original"))

        let downloadHandle: FileHandle | undefined
        yield* driver
          .withDownload(instance, "world/data.txt", (download) =>
            Effect.sync(() => {
              downloadHandle = download.file
              throw new Error("consumer stopped")
            })
          )
          .pipe(Effect.exit)
        assert.strictEqual(downloadHandle?.fd, -1)

        const uploadFailure = yield* driver
          .upload(instance, "world/data.txt", failingChunks())
          .pipe(Effect.flip)
        assert.instanceOf(uploadFailure, RelayFilesystemError)
        assert.strictEqual(uploadFailure.operation, "upload.read")

        const entries = yield* fromPromise(() =>
          readdir(resolve(root, "world"))
        )
        assert.deepEqual(entries, ["data.txt"])
        const contents = yield* driver.withDownload(
          instance,
          "world/data.txt",
          (download) => fromPromise(() => download.file.readFile("utf8"))
        )
        assert.strictEqual(contents, "original")
      })
    )
  )

  it.effect("closes a pinned download descriptor when interrupted", () =>
    withSetup(({ driver, instance }) =>
      Effect.gen(function* () {
        yield* driver.upload(instance, "world/data.txt", chunks("interrupt"))
        const opened = yield* Deferred.make<FileHandle>()
        const fiber = yield* driver
          .withDownload(instance, "world/data.txt", (download) =>
            Deferred.succeed(opened, download.file).pipe(
              Effect.andThen(Effect.never)
            )
          )
          .pipe(Effect.forkChild)
        const handle = yield* Deferred.await(opened)

        yield* Fiber.interrupt(fiber)

        assert.strictEqual(handle.fd, -1)
      })
    )
  )

  it.effect("rejects downloads above the browser transfer limit", () =>
    withSetup(({ driver, instance, root }) =>
      Effect.gen(function* () {
        const oversized = resolve(root, "world", "oversized.bin")
        yield* fromPromise(async () => {
          await writeFile(oversized, "")
          await truncate(oversized, MAX_TRANSFER_BYTES + 1)
        })

        const failure = yield* driver
          .withDownload(instance, "world/oversized.bin", () => Effect.void)
          .pipe(Effect.flip)

        assert.instanceOf(failure, RelayFilesystemError)
        assert.strictEqual(failure.code, "file_too_large")
      })
    )
  )
})

function withSetup<TResult>(
  use: (setup: {
    directory: string
    driver: FilesystemDriver
    instance: RelayInstanceConfig
    root: string
  }) => Effect.Effect<TResult, unknown>
) {
  return Effect.acquireUseRelease(
    fromPromise(() => mkdtemp(resolve(tmpdir(), "kiln-files-test-"))),
    (directory) =>
      Effect.gen(function* () {
        const root = resolve(directory, "instances", "instance-1")
        yield* fromPromise(() =>
          mkdir(resolve(root, "world"), { recursive: true })
        )
        const config = loadConfig({
          KILN_RELAY_DATA_DIR: directory,
          KILN_RELAY_HOST: "relay.test",
          NODE_ENV: "development",
        })
        return yield* use({
          directory,
          driver: new FilesystemDriver(config),
          instance: testInstance(),
          root,
        })
      }),
    (directory) =>
      fromPromise(() => rm(directory, { force: true, recursive: true })).pipe(
        Effect.orDie
      )
  )
}

async function* chunks(value: string): AsyncIterable<Uint8Array> {
  yield Buffer.from(value)
}

async function* failingChunks(): AsyncIterable<Uint8Array> {
  yield Buffer.from("partial")
  throw new Error("upload stream failed")
}

function fromPromise<TResult>(run: () => Promise<TResult>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => cause,
  })
}

function testInstance(): RelayInstanceConfig {
  return {
    connectAddress: "localhost",
    directory: "instance-1",
    game: "Minecraft",
    id: "instance-1",
    implementation: "Paper",
    javaVersion: "21",
    limits: { diskBytes: 0, memoryBytes: 0 },
    managedByRelay: true,
    name: "Test Instance",
    ports: [],
    service: "test",
    shortId: "instance",
    tailscale: { enabled: false },
    version: "1.21.11",
  }
}
