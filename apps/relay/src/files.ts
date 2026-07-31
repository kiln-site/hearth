import {
  lstat,
  open,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import type { FileHandle } from "node:fs/promises"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { gunzip } from "node:zlib"
import { promisify } from "node:util"
import { Effect, Stream } from "effect"

import type {
  RelayFileContent,
  RelayFileTree,
  RelayLatestLog,
  RelaySaveFileInput,
} from "@workspace/contracts"

import type { RelayConfig, RelayInstanceConfig } from "./config.js"
import { RelayFilesystemError } from "./effect/errors.js"

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_LOG_SHARE_BYTES = 10 * 1024 * 1024
const MAX_TREE_ITEMS = 5_000
const MAX_TREE_DEPTH = 10
const MAX_TRANSFER_BYTES = 20 * 1024 * 1024 * 1024
const gunzipAsync = promisify(gunzip)

export class FilesystemDriver {
  readonly #config: RelayConfig

  constructor(config: RelayConfig) {
    this.#config = config
  }

  tree(instance: RelayInstanceConfig) {
    return Effect.gen({ self: this }, function* () {
      const root = yield* this.#instanceRoot(instance)
      const paths: Array<string> = []
      let truncated = false

      const visit = (
        directory: string,
        depth: number
      ): Effect.Effect<void, RelayFilesystemError> =>
        Effect.gen(function* () {
          if (paths.length >= MAX_TREE_ITEMS || depth > MAX_TREE_DEPTH) {
            truncated = true
            return
          }

          const entries = yield* filesystemOperation(
            "tree.readDirectory",
            async () => {
              const values = []
              for await (const entry of await opendir(directory)) {
                values.push(entry)
              }
              return values
            }
          )
          entries.sort((left, right) => {
            if (left.isDirectory() !== right.isDirectory()) {
              return left.isDirectory() ? -1 : 1
            }
            return left.name.localeCompare(right.name)
          })

          for (const entry of entries) {
            if (paths.length >= MAX_TREE_ITEMS) {
              truncated = true
              break
            }
            const absolute = join(directory, entry.name)
            const path = relative(root, absolute).split(sep).join("/")
            if (entry.isDirectory()) {
              paths.push(`${path}/`)
              yield* visit(absolute, depth + 1)
            } else if (entry.isFile() || entry.isSymbolicLink()) {
              paths.push(path)
            }
          }
        })

      yield* visit(root, 0)
      return {
        instanceId: instance.id,
        paths,
        total: paths.length,
        truncated,
      } satisfies RelayFileTree
    }).pipe(Effect.withSpan("relay.files.tree"))
  }

  read(instance: RelayInstanceConfig, requestedPath: string) {
    return Effect.gen({ self: this }, function* () {
      const path = yield* this.#existingFile(instance, requestedPath)
      const metadata = yield* filesystemOperation("read.stat", () => stat(path))
      if (metadata.size > MAX_FILE_BYTES) {
        return yield* filesystemFailure(
          "file_too_large",
          "read",
          `Files larger than ${MAX_FILE_BYTES} bytes cannot be edited`
        )
      }
      const compressed = requestedPath.toLowerCase().endsWith(".log.gz")
      if (requestedPath.toLowerCase().endsWith(".gz") && !compressed) {
        return yield* filesystemFailure(
          "unsupported_file",
          "read",
          "Only Minecraft .log.gz archives can be previewed"
        )
      }

      const source = yield* filesystemOperation("read.contents", () =>
        readFile(path)
      )
      const decoded = compressed
        ? yield* Effect.tryPromise({
            try: () => gunzipAsync(source, { maxOutputLength: MAX_FILE_BYTES }),
            catch: (cause) =>
              makeFilesystemError(
                "invalid_gzip",
                "read.decompress",
                `The archived log is invalid or expands beyond ${MAX_FILE_BYTES} bytes`,
                cause
              ),
          })
        : source
      const content = yield* Effect.try({
        try: () => new TextDecoder("utf-8", { fatal: true }).decode(decoded),
        catch: (cause) =>
          makeFilesystemError(
            "unsupported_file",
            "read.decode",
            "This file is binary and cannot be previewed as text",
            cause
          ),
      })

      return {
        instanceId: instance.id,
        path: requestedPath,
        content,
        size: metadata.size,
        decodedSize: decoded.byteLength,
        encoding: compressed ? "gzip" : "utf8",
        readOnly: compressed,
        modifiedAt: metadata.mtime.toISOString(),
      } satisfies RelayFileContent
    }).pipe(Effect.withSpan("relay.files.read"))
  }

  write(
    instance: RelayInstanceConfig,
    requestedPath: string,
    input: RelaySaveFileInput
  ) {
    return Effect.gen({ self: this }, function* () {
      if (requestedPath.toLowerCase().endsWith(".log.gz")) {
        return yield* filesystemFailure(
          "read_only",
          "write",
          "Archived logs are read-only"
        )
      }
      const path = yield* this.#existingFile(instance, requestedPath)
      const metadata = yield* filesystemOperation("write.stat", () =>
        stat(path)
      )
      if (
        input.expectedModifiedAt &&
        metadata.mtime.toISOString() !== input.expectedModifiedAt
      ) {
        return yield* filesystemFailure(
          "file_changed",
          "write",
          "The file changed on disk after it was opened"
        )
      }

      const temporary = `${path}.hearth-${process.pid}-${randomUUID()}`
      return yield* Effect.acquireUseRelease(
        filesystemOperation("write.temporary", () =>
          writeFile(temporary, input.content, { mode: metadata.mode })
        ),
        () =>
          filesystemOperation("write.replace", () =>
            rename(temporary, path)
          ).pipe(
            Effect.uninterruptible,
            Effect.flatMap(() => this.read(instance, requestedPath))
          ),
        () => cleanupPathEffect(temporary)
      )
    }).pipe(Effect.withSpan("relay.files.write"))
  }

  latestLog(instance: RelayInstanceConfig) {
    return Effect.gen({ self: this }, function* () {
      const requestedPath = "logs/latest.log" as const
      const path = yield* this.#existingFile(instance, requestedPath)
      const metadata = yield* filesystemOperation("latestLog.stat", () =>
        stat(path)
      )
      if (metadata.size > MAX_LOG_SHARE_BYTES) {
        return yield* filesystemFailure(
          "log_too_large",
          "latestLog",
          `latest.log exceeds the ${MAX_LOG_SHARE_BYTES} byte sharing limit`
        )
      }
      const source = yield* filesystemOperation("latestLog.read", () =>
        readFile(path)
      )
      const content = yield* Effect.try({
        try: () => new TextDecoder("utf-8", { fatal: true }).decode(source),
        catch: (cause) =>
          makeFilesystemError(
            "unsupported_file",
            "latestLog.decode",
            "latest.log is not valid UTF-8 text",
            cause
          ),
      })

      return {
        instanceId: instance.id,
        path: requestedPath,
        content,
        size: source.byteLength,
      } satisfies RelayLatestLog
    }).pipe(Effect.withSpan("relay.files.latestLog"))
  }

  withDownload<TResult, TError, TRequirements>(
    instance: RelayInstanceConfig,
    requestedPath: string,
    use: (download: {
      file: FileHandle
      modifiedAt: string
      name: string
      size: number
    }) => Effect.Effect<TResult, TError, TRequirements>
  ) {
    return Effect.gen({ self: this }, function* () {
      yield* requireLinuxDescriptorAnchoring()
      yield* validateRelativePath(requestedPath)
      const root = yield* this.#instanceRoot(instance)
      const candidate = resolve(root, requestedPath)
      yield* ensureContained(root, candidate)

      return yield* Effect.acquireUseRelease(
        filesystemOperation("download.open", () =>
          open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
        ),
        (file) =>
          Effect.gen(function* () {
            const actual = yield* filesystemOperation(
              "download.resolveDescriptor",
              () => realpath(fileDescriptorPath(file))
            )
            yield* ensureContained(root, actual)
            const metadata = yield* filesystemOperation(
              "download.statDescriptor",
              () => file.stat()
            )
            if (!metadata.isFile()) {
              return yield* filesystemFailure(
                "not_a_file",
                "download",
                "Path is not a file"
              )
            }
            return yield* use({
              file,
              modifiedAt: metadata.mtime.toISOString(),
              name: basename(candidate),
              size: metadata.size,
            })
          }),
        (file) => closeHandleEffect(file, "download.close")
      )
    }).pipe(Effect.withSpan("relay.files.download"))
  }

  upload(
    instance: RelayInstanceConfig,
    requestedPath: string,
    source: AsyncIterable<Uint8Array>
  ) {
    return Effect.gen({ self: this }, function* () {
      yield* requireLinuxDescriptorAnchoring()
      yield* validateRelativePath(requestedPath)
      const root = yield* this.#instanceRoot(instance)
      const candidate = resolve(root, requestedPath)
      yield* ensureContained(root, candidate)
      const parent = yield* filesystemOperation("upload.resolveParent", () =>
        realpath(dirname(candidate))
      )
      yield* ensureContained(root, parent)

      return yield* Effect.acquireUseRelease(
        filesystemOperation("upload.openParent", () =>
          open(
            parent,
            fsConstants.O_RDONLY |
              fsConstants.O_DIRECTORY |
              fsConstants.O_NOFOLLOW
          )
        ),
        (parentHandle) =>
          Effect.gen(function* () {
            const anchoredParent = fileDescriptorPath(parentHandle)
            const resolvedParent = yield* filesystemOperation(
              "upload.resolveParentDescriptor",
              () => realpath(anchoredParent)
            )
            yield* ensureContained(root, resolvedParent)
            const target = resolve(anchoredParent, basename(candidate))
            const existing = yield* optionalFileMetadata(target)
            if (existing && !existing.isFile()) {
              return yield* filesystemFailure(
                "not_a_file",
                "upload",
                "Path is not a file"
              )
            }
            const mode = existing ? existing.mode & 0o777 : 0o644
            const temporary = resolve(
              anchoredParent,
              `.kiln-upload-${randomUUID()}`
            )
            let size = 0
            const digest = createHash("sha256")

            yield* Effect.acquireUseRelease(
              filesystemOperation("upload.openTemporary", () =>
                open(temporary, "wx", mode)
              ),
              (file) =>
                Effect.gen(function* () {
                  yield* Stream.fromAsyncIterable(source, (cause) =>
                    makeFilesystemError(
                      "read_failed",
                      "upload.read",
                      errorMessage(cause),
                      cause
                    )
                  ).pipe(
                    Stream.runForEach((chunk) =>
                      Effect.gen(function* () {
                        size += chunk.byteLength
                        if (size > MAX_TRANSFER_BYTES) {
                          return yield* filesystemFailure(
                            "file_too_large",
                            "upload",
                            "Upload exceeds the 20 GiB transfer limit"
                          )
                        }
                        digest.update(chunk)
                        yield* writeFully(file, chunk, null)
                      })
                    )
                  )
                  yield* filesystemOperation("upload.sync", () =>
                    file.sync()
                  ).pipe(Effect.uninterruptible)
                  const currentParent = yield* filesystemOperation(
                    "upload.verifyParent",
                    () => realpath(anchoredParent)
                  )
                  yield* ensureContained(root, currentParent)
                  yield* filesystemOperation("upload.replace", () =>
                    rename(temporary, target)
                  ).pipe(Effect.uninterruptible)
                }),
              (file) =>
                closeHandleEffect(file, "upload.closeTemporary").pipe(
                  Effect.andThen(cleanupPathEffect(temporary))
                )
            )

            const metadata = yield* filesystemOperation("upload.stat", () =>
              stat(target)
            )
            return {
              modifiedAt: metadata.mtime.toISOString(),
              path: requestedPath,
              sha256: digest.digest("hex"),
              size,
            }
          }),
        (parentHandle) => closeHandleEffect(parentHandle, "upload.closeParent")
      )
    }).pipe(Effect.withSpan("relay.files.upload"))
  }

  #existingFile(instance: RelayInstanceConfig, requestedPath: string) {
    return Effect.gen({ self: this }, function* () {
      yield* validateRelativePath(requestedPath)
      const root = yield* this.#instanceRoot(instance)
      const candidate = yield* filesystemOperation("path.resolveFile", () =>
        realpath(resolve(root, requestedPath))
      )
      yield* ensureContained(root, candidate)
      const metadata = yield* filesystemOperation("path.statFile", () =>
        lstat(candidate)
      )
      if (!metadata.isFile()) {
        return yield* filesystemFailure(
          "not_a_file",
          "path",
          "Path is not a file"
        )
      }
      return candidate
    })
  }

  #instanceRoot(instance: RelayInstanceConfig) {
    const config = this.#config
    return Effect.gen(function* () {
      const configuredRoot = yield* filesystemOperation(
        "path.resolveConfiguredRoot",
        () => realpath(config.rootDirectory)
      )
      const root = yield* filesystemOperation("path.resolveInstanceRoot", () =>
        realpath(resolve(configuredRoot, instance.directory))
      )
      yield* ensureContained(configuredRoot, root)
      return root
    })
  }
}

function fileDescriptorPath(file: FileHandle): string {
  return `/proc/self/fd/${file.fd}`
}

function requireLinuxDescriptorAnchoring() {
  return process.platform === "linux"
    ? Effect.void
    : filesystemFailure(
        "unsupported_platform",
        "path",
        "Secure direct file transfers require a Linux Relay host"
      )
}

function writeFully(
  file: FileHandle,
  data: Uint8Array,
  position: number | null
) {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  let written = 0

  const writeNext = (): Effect.Effect<void, RelayFilesystemError> =>
    Effect.suspend(() => {
      if (written >= buffer.length) return Effect.void
      return filesystemOperation("upload.write", () =>
        file.write(
          buffer,
          written,
          buffer.length - written,
          position === null ? null : position + written
        )
      ).pipe(
        // Let an in-flight driver write settle before a finalizer closes the
        // descriptor. Interruption is observed between chunks.
        Effect.uninterruptible,
        Effect.flatMap((result) => {
          if (result.bytesWritten <= 0) {
            return filesystemFailure(
              "write_incomplete",
              "upload.write",
              "Filesystem stopped before the complete upload chunk was written"
            )
          }
          written += result.bytesWritten
          return writeNext()
        })
      )
    })

  return writeNext()
}

function optionalFileMetadata(path: string) {
  return Effect.tryPromise({
    try: () => lstat(path),
    catch: (cause) => cause,
  }).pipe(
    Effect.catch((cause) =>
      isMissingFile(cause)
        ? Effect.succeed(null)
        : Effect.fail(
            makeFilesystemError(
              "io_error",
              "upload.statTarget",
              errorMessage(cause),
              cause
            )
          )
    )
  )
}

function filesystemOperation<TResult>(
  operation: string,
  run: () => Promise<TResult>
) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      cause instanceof RelayFilesystemError
        ? cause
        : makeFilesystemError(
            "io_error",
            operation,
            errorMessage(cause),
            cause
          ),
  })
}

function closeHandleEffect(file: FileHandle, operation: string) {
  return filesystemOperation(operation, () => file.close()).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("Relay filesystem handle cleanup failed", cause)
    )
  )
}

function cleanupPathEffect(path: string) {
  return filesystemOperation("cleanup.temporary", () =>
    rm(path, { force: true })
  ).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("Relay temporary-file cleanup failed", cause)
    )
  )
}

function filesystemFailure(code: string, operation: string, reason: string) {
  return Effect.fail(makeFilesystemError(code, operation, reason))
}

function makeFilesystemError(
  code: string,
  operation: string,
  reason: string,
  cause?: unknown
) {
  return RelayFilesystemError.make({
    code,
    operation,
    reason,
    ...(cause === undefined ? {} : { cause }),
  })
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Filesystem operation failed"
}

function isMissingFile(cause: unknown): boolean {
  return Boolean(
    cause &&
    typeof cause === "object" &&
    "code" in cause &&
    cause.code === "ENOENT"
  )
}

function validateRelativePath(path: string) {
  if (
    path &&
    !path.includes("\0") &&
    !path.startsWith("/") &&
    !path.split(/[\\/]/u).includes("..")
  ) {
    return Effect.void
  }
  return filesystemFailure("invalid_path", "path", "Invalid relative path")
}

function ensureContained(root: string, candidate: string) {
  const normalizedRoot = resolve(root)
  const normalizedCandidate = resolve(candidate)
  return normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)
    ? Effect.void
    : filesystemFailure(
        "path_outside_instance",
        "path",
        "Path resolves outside the instance directory"
      )
}
