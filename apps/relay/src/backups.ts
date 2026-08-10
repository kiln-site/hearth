import { createHash, randomUUID } from "node:crypto"
import {
  constants as fsConstants,
  createReadStream,
  createWriteStream,
  type ReadStream,
} from "node:fs"
import { request as httpsRequest } from "node:https"
import {
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rm,
  stat,
  statfs,
} from "node:fs/promises"
import { basename, relative, resolve, sep } from "node:path"
import { isIP } from "node:net"
import { constants as zlibConstants } from "node:zlib"
import { Effect, Fiber, Queue, Result } from "effect"
import { minimatch } from "minimatch"
import ZipStream from "zip-stream"

import type {
  BackupArchiveManifest,
  BackupCreateTaskInput,
  BackupCreateTaskResult,
  BackupDeleteTaskInput,
  BackupTaskInput,
  RelayBackupTask,
} from "@workspace/contracts"

import type { RelayConfig, RelayInstanceConfig } from "./config.js"
import type { DatabaseDriver } from "./databases.js"
import {
  createCompressedDatabaseBackup,
  restoreCompressedDatabaseBackup,
} from "./database-backups.js"
import { createEncryptedPlatformBackup } from "./platform-backups.js"
import { RelayBackupError } from "./effect/errors.js"
import { promiseEffect } from "./effect/promise.js"
import { RelayStateStore } from "./effect/state.js"
import { isPublicRemoteAddress, secureRemoteLookup } from "./source-policy.js"
import {
  materializeBackupArtifact,
  recoverInterruptedRestores,
  restorePortableInstanceBackup,
} from "./backup-restore.js"

const MAX_BACKUP_ENTRIES = 100_000
const ZIP_OVERHEAD_RESERVE_BYTES = 64 * 1024 * 1024
const MAX_S3_SINGLE_PUT_BYTES = 5 * 1024 ** 3
const BACKUP_TRANSFER_IDLE_TIMEOUT_MS = 30_000
const DEFAULT_EXCLUDES = [
  ".DS_Store",
  "Thumbs.db",
  "session.lock",
  "**/session.lock",
  "*.pid",
  "**/*.pid",
  ".kiln-backup",
  ".kiln-backup/**",
] as const

type BackupProgress = {
  completed: number
  total: number
}

type ArchiveEntry = {
  absolute: string
  device: number
  inode: number
  mode: number
  modifiedAt: number
  name: string
  size: number
}

type CreateArchive = (
  input: BackupCreateTaskInput,
  instance: RelayInstanceConfig,
  progress: BackupProgress
) => Promise<BackupCreateTaskResult>

export class BackupManager {
  readonly #config: RelayConfig
  readonly #createArchive: CreateArchive
  readonly #findInstance: (
    instanceId: string
  ) => Promise<RelayInstanceConfig | null>
  readonly #isInstanceStopped: (instanceId: string) => Promise<boolean>
  readonly #databases: DatabaseDriver | null
  readonly #state: RelayStateStore["Service"]
  readonly #wake: Queue.Queue<void>

  private constructor(options: {
    config: RelayConfig
    createArchive: CreateArchive
    findInstance: (instanceId: string) => Promise<RelayInstanceConfig | null>
    isInstanceStopped: (instanceId: string) => Promise<boolean>
    databases: DatabaseDriver | null
    state: RelayStateStore["Service"]
    wake: Queue.Queue<void>
  }) {
    this.#createArchive = options.createArchive
    this.#config = options.config
    this.#findInstance = options.findInstance
    this.#isInstanceStopped = options.isInstanceStopped
    this.#databases = options.databases
    this.#state = options.state
    this.#wake = options.wake
  }

  static make(options: {
    config: RelayConfig
    createArchive?: CreateArchive
    findInstance: (instanceId: string) => Promise<RelayInstanceConfig | null>
    isInstanceStopped: (instanceId: string) => Promise<boolean>
    databases?: DatabaseDriver
  }) {
    return Effect.gen(function* () {
      const state = yield* RelayStateStore
      const wake = yield* Queue.unbounded<void>()
      const manager = new BackupManager({
        config: options.config,
        createArchive:
          options.createArchive ??
          ((input, instance, progress) =>
            createPortableInstanceBackup(
              options.config,
              input,
              instance,
              progress
            )),
        findInstance: options.findInstance,
        isInstanceStopped: options.isInstanceStopped,
        databases: options.databases ?? null,
        state,
        wake,
      })
      const recovered = yield* Effect.tryPromise(() =>
        recoverInterruptedRestores(options.config)
      )
      for (const taskId of recovered) {
        yield* state.completeBackupTask(
          taskId,
          { warnings: ["Restore completed during Relay recovery"] },
          Date.now()
        )
      }
      yield* state.requeueInterruptedBackupTasks(Date.now())
      yield* Queue.offer(wake, undefined)
      return manager
    })
  }

  enqueue(input: BackupTaskInput) {
    return Effect.gen({ self: this }, function* () {
      const task = yield* this.#state.enqueueBackupTask(input, Date.now())
      yield* Queue.offer(this.#wake, undefined)
      return task
    })
  }

  get(taskId: string) {
    return this.#state.getBackupTask(taskId)
  }

  list(updatedAfter?: number) {
    return this.#state.listBackupTasks(updatedAfter)
  }

  run() {
    return Effect.gen({ self: this }, function* () {
      while (true) {
        yield* Queue.take(this.#wake)
        yield* this.#drain()
      }
    })
  }

  runPending() {
    return this.#drain()
  }

  #drain() {
    return Effect.gen({ self: this }, function* () {
      while (true) {
        const task = yield* this.#state.claimNextBackupTask(Date.now())
        if (!task) return
        yield* this.#execute(task).pipe(
          Effect.catch((cause) =>
            this.#state
              .failBackupTask(
                task.taskId,
                backupErrorMessage(cause),
                Date.now()
              )
              .pipe(
                Effect.tap(() =>
                  Effect.logError("Relay backup task failed", {
                    backupId: task.backupId,
                    cause,
                    taskId: task.taskId,
                  })
                ),
                Effect.asVoid
              )
          )
        )
      }
    })
  }

  #execute(task: RelayBackupTask) {
    return Effect.gen({ self: this }, function* () {
      if (task.input.kind === "restore") {
        const input = task.input
        if (input.target.kind === "database") {
          if (!this.#databases) {
            return yield* backupFailure(
              "database_driver_unavailable",
              "restore.lookup",
              "The database backup driver is unavailable"
            )
          }
          const temporary = resolve(
            this.#config.dataDirectory,
            "restores",
            `${input.taskId}.dmp.gz`
          )
          const artifact = yield* Effect.tryPromise({
            try: () =>
              materializeBackupArtifact(this.#config, input, temporary),
            catch: (cause) =>
              RelayBackupError.make({
                code: "database_restore_download_failed",
                operation: "restore.database.verify",
                reason: backupErrorMessage(cause),
                cause,
              }),
          })
          const result = yield* Effect.tryPromise({
            try: () =>
              restoreCompressedDatabaseBackup(
                this.#databases!,
                input.target.id,
                artifact
              ),
            catch: (cause) =>
              RelayBackupError.make({
                code: "database_restore_failed",
                operation: "restore.database",
                reason: backupErrorMessage(cause),
                cause,
              }),
          }).pipe(
            Effect.ensuring(
              input.source.kind === "remote"
                ? promiseEffect(() => rm(temporary, { force: true })).pipe(
                    Effect.ignore
                  )
                : Effect.void
            )
          )
          const completed = yield* this.#state.completeBackupTask(
            task.taskId,
            result,
            Date.now()
          )
          if (!completed) {
            return yield* backupFailure(
              "task_state_changed",
              "restore.complete",
              "The backup task was no longer running when restore completed"
            )
          }
          return
        }
        if (input.target.kind !== "instance") {
          return yield* backupFailure(
            "unsupported_restore",
            "restore",
            "This Relay currently supports instance archive restores"
          )
        }
        const instance = yield* Effect.tryPromise({
          try: () => this.#findInstance(input.target.id),
          catch: (cause) =>
            RelayBackupError.make({
              code: "instance_lookup_failed",
              operation: "restore.lookup",
              reason: "The restore target could not be loaded",
              cause,
            }),
        })
        if (!instance) {
          return yield* backupFailure(
            "instance_not_found",
            "restore.lookup",
            "The restore target no longer exists on this Relay"
          )
        }
        const stopped = yield* Effect.tryPromise({
          try: () => this.#isInstanceStopped(input.target.id),
          catch: (cause) =>
            RelayBackupError.make({
              code: "instance_state_failed",
              operation: "restore.preflight",
              reason: "The Relay could not verify the server power state",
              cause,
            }),
        })
        if (!stopped) {
          return yield* backupFailure(
            "instance_running",
            "restore.preflight",
            "Stop the server before restoring a backup"
          )
        }
        const result = yield* Effect.tryPromise({
          try: () =>
            restorePortableInstanceBackup(
              this.#config,
              { ...input, kind: "restore" },
              instance
            ),
          catch: (cause) =>
            cause instanceof RelayBackupError
              ? cause
              : RelayBackupError.make({
                  code: "restore_failed",
                  operation: "restore",
                  reason: backupErrorMessage(cause),
                  cause,
                }),
        })
        const completed = yield* this.#state.completeBackupTask(
          task.taskId,
          result,
          Date.now()
        )
        if (!completed) {
          return yield* backupFailure(
            "task_state_changed",
            "restore.complete",
            "The backup task was no longer running when restore completed"
          )
        }
        return
      }
      if (task.input.kind === "delete") {
        const result = yield* deleteBackupArtifact(this.#config, task.input)
        const completed = yield* this.#state.completeBackupTask(
          task.taskId,
          result,
          Date.now()
        )
        if (!completed) {
          return yield* backupFailure(
            "task_state_changed",
            "delete.complete",
            "The backup task was no longer running when deletion completed"
          )
        }
        return
      }
      const input = task.input
      if (
        input.target.kind === "platform" &&
        input.artifactKind === "platform_bundle" &&
        input.mode === "full"
      ) {
        const progress = { completed: 0, total: 0 }
        const progressFiber = yield* Effect.forkChild(
          Effect.sleep("500 millis").pipe(
            Effect.andThen(
              Effect.suspend(() =>
                this.#state
                  .updateBackupTaskProgress(
                    task.taskId,
                    progress.completed,
                    null,
                    Date.now()
                  )
                  .pipe(Effect.asVoid)
              )
            ),
            Effect.forever
          )
        )
        const destination = backupArchivePath(this.#config, input.backupId)
        yield* promiseEffect(() =>
          mkdir(backupDirectoryPath(this.#config), {
            recursive: true,
            mode: 0o700,
          })
        )
        yield* promiseEffect(() => rm(destination, { force: true }))
        const created = yield* Effect.tryPromise({
          try: () =>
            createEncryptedPlatformBackup(
              this.#config,
              input,
              destination,
              progress
            ),
          catch: (cause) =>
            RelayBackupError.make({
              code: "platform_backup_failed",
              operation: "create.platform",
              reason: backupErrorMessage(cause),
              cause,
            }),
        }).pipe(Effect.ensuring(Fiber.interrupt(progressFiber)))
        const result =
          input.destination.kind === "s3"
            ? yield* uploadBackupArtifact(
                this.#config,
                { ...input, destination: input.destination },
                created
              ).pipe(
                Effect.ensuring(
                  promiseEffect(() => rm(destination, { force: true })).pipe(
                    Effect.ignore
                  )
                )
              )
            : created
        const completed = yield* this.#state.completeBackupTask(
          task.taskId,
          result,
          Date.now()
        )
        if (!completed) {
          return yield* backupFailure(
            "task_state_changed",
            "create.complete",
            "The backup task was no longer running when the platform bundle completed"
          )
        }
        return
      }
      if (
        input.target.kind === "database" &&
        input.artifactKind === "database_dump" &&
        input.mode === "full"
      ) {
        if (!this.#databases) {
          return yield* backupFailure(
            "database_driver_unavailable",
            "create.database",
            "The database backup driver is unavailable"
          )
        }
        const progress = { completed: 0, total: 0 }
        const progressFiber = yield* Effect.forkChild(
          Effect.sleep("500 millis").pipe(
            Effect.andThen(
              Effect.suspend(() =>
                this.#state
                  .updateBackupTaskProgress(
                    task.taskId,
                    progress.completed,
                    null,
                    Date.now()
                  )
                  .pipe(Effect.asVoid)
              )
            ),
            Effect.forever
          )
        )
        const destination = backupArchivePath(this.#config, input.backupId)
        yield* promiseEffect(() =>
          mkdir(backupDirectoryPath(this.#config), {
            recursive: true,
            mode: 0o700,
          })
        )
        yield* promiseEffect(() => rm(destination, { force: true }))
        const created = yield* Effect.tryPromise({
          try: () =>
            createCompressedDatabaseBackup(
              this.#databases!,
              input,
              destination,
              progress
            ),
          catch: (cause) =>
            RelayBackupError.make({
              code: "database_backup_failed",
              operation: "create.database",
              reason: backupErrorMessage(cause),
              cause,
            }),
        }).pipe(Effect.ensuring(Fiber.interrupt(progressFiber)))
        const result =
          input.destination.kind === "s3"
            ? yield* uploadBackupArtifact(
                this.#config,
                { ...input, destination: input.destination },
                created
              ).pipe(
                Effect.ensuring(
                  promiseEffect(() => rm(destination, { force: true })).pipe(
                    Effect.ignore
                  )
                )
              )
            : created
        const completed = yield* this.#state.completeBackupTask(
          task.taskId,
          result,
          Date.now()
        )
        if (!completed) {
          return yield* backupFailure(
            "task_state_changed",
            "create.complete",
            "The backup task was no longer running when the dump completed"
          )
        }
        return
      }
      if (
        input.target.kind !== "instance" ||
        input.artifactKind !== "archive" ||
        input.mode !== "full"
      ) {
        return yield* backupFailure(
          "unsupported_backup",
          "create",
          "This Relay currently supports full instance archives"
        )
      }
      const instance = yield* Effect.tryPromise({
        try: () => this.#findInstance(input.target.id),
        catch: (cause) =>
          RelayBackupError.make({
            code: "instance_lookup_failed",
            operation: "create.lookup",
            reason: "The backup target could not be loaded",
            cause,
          }),
      })
      if (!instance) {
        return yield* backupFailure(
          "instance_not_found",
          "create.lookup",
          "The backup target no longer exists on this Relay"
        )
      }

      const progress = { completed: 0, total: 0 }
      const progressFiber = yield* Effect.forkChild(
        Effect.sleep("500 millis").pipe(
          Effect.andThen(
            Effect.suspend(() =>
              this.#state
                .updateBackupTaskProgress(
                  task.taskId,
                  progress.completed,
                  progress.total || null,
                  Date.now()
                )
                .pipe(Effect.asVoid)
            )
          ),
          Effect.forever
        )
      )
      const archived = yield* Effect.tryPromise({
        try: () => this.#createArchive(input, instance, progress),
        catch: (cause) =>
          cause instanceof RelayBackupError
            ? cause
            : RelayBackupError.make({
                code: "archive_failed",
                operation: "create.archive",
                reason: backupErrorMessage(cause),
                cause,
              }),
      }).pipe(Effect.ensuring(Fiber.interrupt(progressFiber)))
      const destination = input.destination
      const result =
        destination.kind === "s3"
          ? yield* uploadBackupArtifact(
              this.#config,
              { ...input, destination },
              archived
            ).pipe(
              Effect.ensuring(
                promiseEffect(() =>
                  rm(backupArchivePath(this.#config, input.backupId), {
                    force: true,
                  })
                ).pipe(Effect.ignore)
              )
            )
          : archived
      const completed = yield* this.#state.completeBackupTask(
        task.taskId,
        result,
        Date.now()
      )
      if (!completed) {
        return yield* backupFailure(
          "task_state_changed",
          "create.complete",
          "The backup task was no longer running when the archive completed"
        )
      }
    })
  }
}

export async function createPortableInstanceBackup(
  config: RelayConfig,
  input: BackupCreateTaskInput,
  instance: RelayInstanceConfig,
  progress: BackupProgress
): Promise<BackupCreateTaskResult> {
  const configuredRoot = await realpath(config.rootDirectory)
  const instanceRoot = await realpath(
    resolve(configuredRoot, instance.directory)
  )
  requireContained(configuredRoot, instanceRoot)
  const backupDirectory = backupDirectoryPath(config)
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 })
  const destination = backupArchivePath(config, input.backupId)
  const maximumBytes =
    input.destination.kind === "s3"
      ? Math.min(
          input.maxBytes ?? MAX_S3_SINGLE_PUT_BYTES,
          MAX_S3_SINGLE_PUT_BYTES
        )
      : input.maxBytes
  const patterns = [...DEFAULT_EXCLUDES, ...input.exclude]
  let warnings: Array<string> = []

  await cleanupBackupPartials(backupDirectory, input.backupId)
  await rm(destination, { force: true })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const temporary = resolve(
      backupDirectory,
      `.${input.backupId}.${randomUUID()}.partial`
    )
    const result = await Effect.runPromise(
      Effect.tryPromise({
        try: async () => {
          const collected = await collectBackupEntries(instanceRoot, patterns)
          progress.completed = 0
          progress.total = collected.entries.reduce(
            (total, entry) => total + entry.size,
            0
          )
          await requireBackupSpace(
            backupDirectory,
            progress.total,
            maximumBytes
          )
          const written = await writeBackupArchive(
            temporary,
            collected.entries,
            maximumBytes,
            progress,
            {
              artifactKind: "archive",
              backupId: input.backupId,
              createdAt: new Date().toISOString(),
              formatVersion: 1,
              mode: "full",
              target: input.target,
            }
          )
          warnings = [...collected.warnings, ...written.warnings]
          if (written.changed.length > 0 && attempt === 0) {
            return null
          }
          if (written.changed.length > 0) {
            warnings.push(
              backupWarning(
                `${written.changed.length} file${written.changed.length === 1 ? "" : "s"} changed while being archived: ${written.changed.slice(0, 10).join(", ")}`
              )
            )
          }
          await rename(temporary, destination)
          return {
            bytes: written.bytes,
            checksumSha256: written.checksumSha256,
            filename: basename(destination),
            warnings: warnings.slice(0, 1_000),
          } satisfies BackupCreateTaskResult
        },
        catch: (cause) =>
          cause instanceof RelayBackupError
            ? cause
            : RelayBackupError.make({
                code: "archive_failed",
                operation: "create.archive",
                reason: backupErrorMessage(cause),
                cause,
              }),
      }).pipe(
        Effect.ensuring(
          promiseEffect(() => rm(temporary, { force: true })).pipe(
            Effect.ignore
          )
        )
      )
    )
    if (result) return result
  }
  throw RelayBackupError.make({
    code: "archive_failed",
    operation: "create.archive",
    reason: "The archive could not be completed",
  })
}

function uploadBackupArtifact(
  config: RelayConfig,
  input: BackupCreateTaskInput & {
    destination: Extract<BackupCreateTaskInput["destination"], { kind: "s3" }>
  },
  result: BackupCreateTaskResult
) {
  if (result.bytes > MAX_S3_SINGLE_PUT_BYTES) {
    return backupFailure(
      "s3_single_put_too_large",
      "create.upload",
      "S3 backups cannot exceed 5 GiB until multipart upload support is enabled"
    )
  }
  return Effect.tryPromise({
    try: () =>
      sendSignedBackupRequest({
        allowPrivateNetwork: input.destination.allowPrivateNetwork,
        bodyPath: backupArchivePath(config, input.backupId),
        headers: {
          ...input.destination.headers,
          "content-length": String(result.bytes),
        },
        method: "PUT",
        url: input.destination.uploadUrl,
      }),
    catch: (cause) =>
      RelayBackupError.make({
        code: "s3_upload_failed",
        operation: "create.upload",
        reason: "The backup archive could not be uploaded to S3 storage",
        cause,
      }),
  }).pipe(Effect.as(result))
}

function deleteBackupArtifact(
  config: RelayConfig,
  input: BackupDeleteTaskInput & { kind: "delete" }
) {
  if (input.destination.kind === "local") {
    return promiseEffect(() =>
      rm(backupArchivePath(config, input.backupId), { force: true })
    ).pipe(Effect.as({ warnings: [] }))
  }
  const destination = input.destination
  return Effect.tryPromise({
    try: () =>
      sendSignedBackupRequest({
        allowPrivateNetwork: destination.allowPrivateNetwork,
        headers: destination.headers,
        method: "DELETE",
        url: destination.deleteUrl,
      }),
    catch: (cause) =>
      RelayBackupError.make({
        code: "s3_delete_failed",
        operation: "delete.remote",
        reason: "The backup archive could not be deleted from S3 storage",
        cause,
      }),
  }).pipe(Effect.as({ warnings: [] }))
}

function sendSignedBackupRequest(input: {
  allowPrivateNetwork: boolean
  bodyPath?: string
  headers: Readonly<Record<string, string>>
  method: "DELETE" | "PUT"
  url: string
}): Promise<void> {
  const url = new URL(input.url)
  if (url.protocol !== "https:" || url.username || url.password) {
    return Promise.reject(new Error("Signed backup URLs must use HTTPS"))
  }
  const literal = url.hostname.replace(/^\[|\]$/gu, "")
  if (
    !input.allowPrivateNetwork &&
    isIP(literal) !== 0 &&
    !isPublicRemoteAddress(literal)
  ) {
    return Promise.reject(
      new Error("Signed backup URL resolves to a private or reserved address")
    )
  }
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpsRequest(
      url,
      {
        headers: input.headers,
        lookup: input.allowPrivateNetwork ? undefined : secureRemoteLookup,
        method: input.method,
      },
      (response) => {
        let responseBytes = 0
        response.on("data", (chunk: Buffer) => {
          responseBytes += chunk.byteLength
          if (responseBytes > 64 * 1024) {
            response.destroy(new Error("S3 storage response was too large"))
          }
        })
        response.once("aborted", () => {
          rejectRequest(new Error("S3 storage closed the response early"))
        })
        response.once("end", () => {
          const status = response.statusCode ?? 0
          if (status >= 200 && status < 300) resolveRequest()
          else rejectRequest(new Error(`S3 storage returned HTTP ${status}`))
        })
        response.once("error", rejectRequest)
      }
    )
    request.setTimeout(BACKUP_TRANSFER_IDLE_TIMEOUT_MS, () => {
      request.destroy(new Error("S3 backup request timed out"))
    })
    request.once("error", rejectRequest)
    if (input.bodyPath) {
      const body = createReadStream(input.bodyPath)
      body.once("error", (cause) => request.destroy(cause))
      body.pipe(request)
    } else {
      request.end()
    }
  })
}

function backupDirectoryPath(config: RelayConfig): string {
  return resolve(config.dataDirectory, "backups")
}

function backupArchivePath(config: RelayConfig, backupId: string): string {
  return resolve(backupDirectoryPath(config), `${backupId}.zip`)
}

async function cleanupBackupPartials(
  backupDirectory: string,
  backupId: string
): Promise<void> {
  const prefix = `.${backupId}.`
  for await (const entry of await opendir(backupDirectory)) {
    if (
      entry.isFile() &&
      entry.name.startsWith(prefix) &&
      entry.name.endsWith(".partial")
    ) {
      await rm(resolve(backupDirectory, entry.name), { force: true })
    }
  }
}

async function collectBackupEntries(
  root: string,
  patterns: ReadonlyArray<string>
): Promise<{ entries: Array<ArchiveEntry>; warnings: Array<string> }> {
  const entries: Array<ArchiveEntry> = []
  const warnings: Array<string> = []

  const visit = async (directory: string): Promise<void> => {
    const children = []
    for await (const child of await opendir(directory)) children.push(child)
    children.sort((left, right) => left.name.localeCompare(right.name))
    for (const child of children) {
      const absolute = resolve(directory, child.name)
      requireContained(root, absolute)
      const name = relative(root, absolute).split(sep).join("/")
      const inspected = await Effect.runPromise(
        Effect.result(promiseEffect(() => lstat(absolute)))
      )
      if (Result.isFailure(inspected)) {
        const cause = inspected.failure
        if (!isSkippableFilesystemChange(cause)) throw cause
        warnings.push(
          backupWarning(
            `Skipped entry that changed during collection: ${name} (${backupErrorMessage(cause)})`
          )
        )
        continue
      }
      const metadata = inspected.success
      if (backupPathIsExcluded(name, metadata.isDirectory(), patterns)) continue
      if (metadata.isDirectory()) {
        const visited = await Effect.runPromise(
          Effect.result(promiseEffect(() => visit(absolute)))
        )
        if (Result.isFailure(visited)) {
          const cause = visited.failure
          if (!isSkippableFilesystemChange(cause)) throw cause
          warnings.push(
            backupWarning(
              `Skipped directory that changed during collection: ${name} (${backupErrorMessage(cause)})`
            )
          )
        }
        continue
      }
      if (!metadata.isFile()) {
        warnings.push(backupWarning(`Skipped unsupported entry: ${name}`))
        continue
      }
      entries.push({
        absolute,
        device: metadata.dev,
        inode: metadata.ino,
        mode: metadata.mode,
        modifiedAt: metadata.mtimeMs,
        name,
        size: metadata.size,
      })
      if (entries.length > MAX_BACKUP_ENTRIES) {
        throw RelayBackupError.make({
          code: "too_many_entries",
          operation: "create.collect",
          reason: `Backups cannot contain more than ${MAX_BACKUP_ENTRIES.toLocaleString("en-US")} files`,
        })
      }
    }
  }

  await visit(root)
  return { entries, warnings }
}

async function requireBackupSpace(
  directory: string,
  logicalBytes: number,
  maxBytes: number | null
): Promise<void> {
  const filesystem = await statfs(directory)
  const available = BigInt(filesystem.bavail) * BigInt(filesystem.bsize)
  const estimate = BigInt(logicalBytes + ZIP_OVERHEAD_RESERVE_BYTES)
  const required =
    maxBytes === null
      ? estimate
      : estimate < BigInt(maxBytes)
        ? estimate
        : BigInt(maxBytes)
  if (available < required) {
    throw RelayBackupError.make({
      code: "insufficient_space",
      operation: "create.preflight",
      reason: "The Relay does not have enough free space to stage this backup",
    })
  }
}

function writeBackupArchive(
  destination: string,
  entries: ReadonlyArray<ArchiveEntry>,
  maxBytes: number | null,
  progress: BackupProgress,
  manifest: BackupArchiveManifest
): Promise<{
  bytes: number
  changed: Array<string>
  checksumSha256: string
  warnings: Array<string>
}> {
  return new Promise((resolveArchive, reject) => {
    const archive = new ZipStream({
      forceZip64: true,
      zlib: { level: zlibConstants.Z_BEST_SPEED },
    })
    const output = createWriteStream(destination, {
      flags: "wx",
      mode: 0o600,
    })
    const digest = createHash("sha256")
    const changed: Array<string> = []
    const warnings: Array<string> = []
    let activeSource: ReadStream | null = null
    let bytes = 0
    let settled = false

    const cleanup = () => {
      archive.off("error", failed)
      output.off("error", failed)
      output.off("close", finished)
      archive.off("data", outputChunk)
      activeSource?.off("error", failed)
    }
    const finish = (cause?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (cause) reject(cause)
      else
        resolveArchive({
          bytes,
          changed,
          checksumSha256: digest.digest("hex"),
          warnings,
        })
    }
    const failed = (cause: Error) => {
      activeSource?.destroy()
      archive.destroy()
      output.destroy()
      finish(cause)
    }
    const outputChunk = (chunk: Buffer) => {
      bytes += chunk.byteLength
      if (maxBytes !== null && bytes > maxBytes) {
        failed(
          RelayBackupError.make({
            code: "size_limit_exceeded",
            operation: "create.write",
            reason: "The compressed backup exceeds the configured size limit",
          })
        )
        return
      }
      digest.update(chunk)
    }
    const finished = () => finish()
    archive.once("error", failed)
    output.once("error", failed)
    output.once("close", finished)
    archive.on("data", outputChunk)
    archive.pipe(output)

    const append = (index: number) => {
      Effect.runFork(
        promiseEffect(() => appendEntry(index)).pipe(
          Effect.catch((cause) =>
            Effect.sync(() =>
              failed(
                cause instanceof Error
                  ? cause
                  : new Error("Backup archive entry failed", { cause })
              )
            )
          )
        )
      )
    }
    const appendEntry = async (index: number): Promise<void> => {
      if (settled) return
      const entry = entries[index]
      if (!entry) {
        archive.entry(
          Buffer.from(`${JSON.stringify(manifest)}\n`),
          {
            date: new Date(manifest.createdAt),
            mode: 0o100600,
            name: ".kiln-backup/manifest.json",
          },
          (cause) => {
            if (cause) failed(cause)
            else archive.finalize()
          }
        )
        return
      }
      const openedResult = await Effect.runPromise(
        Effect.result(
          promiseEffect(() =>
            open(entry.absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
          ).pipe(
            Effect.flatMap((handle) =>
              promiseEffect(() => handle.stat()).pipe(
                Effect.map((metadata) => ({ handle, metadata })),
                Effect.onError(() =>
                  promiseEffect(() => handle.close()).pipe(Effect.ignore)
                )
              )
            )
          )
        )
      )
      if (Result.isFailure(openedResult)) {
        const cause = openedResult.failure
        if (!isSkippableFilesystemChange(cause)) throw cause
        changed.push(entry.name)
        warnings.push(
          backupWarning(
            `Skipped entry that changed before it was archived: ${entry.name} (${backupErrorMessage(cause)})`
          )
        )
        progress.completed += entry.size
        append(index + 1)
        return
      }
      const { handle, metadata: opened } = openedResult.success
      if (
        !opened.isFile() ||
        opened.dev !== entry.device ||
        opened.ino !== entry.inode
      ) {
        await handle.close()
        changed.push(entry.name)
        warnings.push(
          backupWarning(`Skipped entry replaced during backup: ${entry.name}`)
        )
        progress.completed += entry.size
        append(index + 1)
        return
      }
      const source = handle.createReadStream()
      activeSource = source
      source.once("error", failed)
      source.on("data", (chunk) => {
        progress.completed += Buffer.byteLength(chunk)
      })
      archive.entry(
        source,
        {
          date: new Date(entry.modifiedAt),
          mode: entry.mode,
          name: entry.name,
        },
        async (cause) => {
          source.off("error", failed)
          activeSource = null
          if (cause) {
            failed(cause)
            return
          }
          const inspected = await Effect.runPromise(
            Effect.result(promiseEffect(() => stat(entry.absolute)))
          )
          if (Result.isSuccess(inspected)) {
            const after = inspected.success
            if (
              after.dev !== entry.device ||
              after.ino !== entry.inode ||
              after.size !== entry.size ||
              after.mtimeMs !== entry.modifiedAt
            ) {
              changed.push(entry.name)
            }
          } else {
            warnings.push(
              backupWarning(
                `File vanished after it was archived: ${entry.name} (${backupErrorMessage(inspected.failure)})`
              )
            )
            changed.push(entry.name)
          }
          append(index + 1)
        }
      )
    }
    append(0)
  })
}

export function backupPathIsExcluded(
  path: string,
  directory: boolean,
  patterns: ReadonlyArray<string>
): boolean {
  let excluded = false
  for (const rawPattern of patterns) {
    const trimmed = rawPattern.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const negated = trimmed.startsWith("!")
    const pattern = negated ? trimmed.slice(1) : trimmed
    if (!pattern) continue
    const candidate = directory ? `${path}/` : path
    const matched = minimatch(candidate, pattern, {
      dot: true,
      matchBase: !pattern.includes("/"),
      nocase: false,
    })
    if (matched) excluded = !negated
  }
  return excluded
}

function requireContained(root: string, candidate: string): void {
  const normalizedRoot = resolve(root)
  const normalizedCandidate = resolve(candidate)
  if (
    normalizedCandidate !== normalizedRoot &&
    !normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)
  ) {
    throw RelayBackupError.make({
      code: "path_outside_instance",
      operation: "create.path",
      reason: "The backup path resolves outside the instance directory",
    })
  }
}

function backupFailure(code: string, operation: string, reason: string) {
  return Effect.fail(RelayBackupError.make({ code, operation, reason }))
}

function backupErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Backup operation failed"
}

function backupWarning(message: string): string {
  return message.slice(0, 1_024)
}

function isSkippableFilesystemChange(cause: unknown): boolean {
  if (!(cause instanceof Error) || !("code" in cause)) return false
  return ["EACCES", "ELOOP", "ENOENT", "ENOTDIR", "EPERM"].includes(
    String(cause.code)
  )
}
