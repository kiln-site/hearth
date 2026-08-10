import { createHash } from "node:crypto"
import { createWriteStream, existsSync, mkdtempSync, rmSync } from "node:fs"
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, assert, describe, it, layer } from "@effect/vitest"
import { Effect } from "effect"
import ZipStream from "zip-stream"

import type {
  BackupCreateTaskInput,
  BackupCreateTaskResult,
  BackupRestoreTaskInput,
} from "@workspace/contracts"
import { relayBackupTaskSchema } from "@workspace/contracts"

import {
  BackupManager,
  backupPathIsExcluded,
  createPortableInstanceBackup,
} from "./backups.js"
import {
  recoverInterruptedRestores,
  restorePortableInstanceBackup,
} from "./backup-restore.js"
import { loadConfig, type RelayInstanceConfig } from "./config.js"
import { makeRelayStateLayer } from "./effect/state.js"

const testDirectory = mkdtempSync(join(tmpdir(), "kiln-backups-"))

afterAll(() => {
  rmSync(testDirectory, { force: true, recursive: true })
})

describe("Relay backups", () => {
  it("rejects inconsistent task envelopes and result kinds", () => {
    const input = backupInput(4)
    const task = {
      backupId: input.backupId,
      bytesCompleted: 1,
      bytesTotal: 1,
      createdAt: 1,
      error: null,
      finishedAt: 2,
      input,
      inputRefreshRequired: false,
      kind: "create" as const,
      result: backupResult(0),
      startedAt: 1,
      status: "succeeded" as const,
      taskId: input.taskId,
      updatedAt: 2,
    }
    assert.isTrue(relayBackupTaskSchema.safeParse(task).success)
    assert.isFalse(
      relayBackupTaskSchema.safeParse({
        ...task,
        backupId: backupInput(5).backupId,
      }).success
    )
    assert.isFalse(
      relayBackupTaskSchema.safeParse({
        ...task,
        result: { warnings: [] },
      }).success
    )
  })

  layer(makeRelayStateLayer(join(testDirectory, "relay.sqlite")))((it) => {
    it.effect("runs durable tasks through one Relay-wide worker", () =>
      Effect.gen(function* () {
        let active = 0
        let maxActive = 0
        const executionOrder: Array<number> = []
        let call = 0
        const manager = yield* BackupManager.make({
          config: loadConfig({
            KILN_RELAY_DATA_DIR: testDirectory,
            KILN_RELAY_HOST: "relay.test",
            NODE_ENV: "test",
          }),
          createArchive: async () => {
            const index = call
            call += 1
            active += 1
            maxActive = Math.max(maxActive, active)
            executionOrder.push(index)
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 25))
            active -= 1
            return backupResult(index)
          },
          findInstance: async () => testInstance(),
          isInstanceStopped: async () => true,
        })
        const first = backupInput(1)
        const second = backupInput(2)
        yield* manager.enqueue(first)
        yield* manager.enqueue(second)
        yield* manager.runPending()

        assert.deepStrictEqual(executionOrder, [0, 1])
        assert.strictEqual(maxActive, 1)
        assert.deepStrictEqual(
          (yield* manager.list()).map((task) => task.status),
          ["succeeded", "succeeded"]
        )
      })
    )
  })

  it.effect("creates an atomic, checksummed archive with safe exclusions", () =>
    Effect.acquireUseRelease(
      Effect.promise(() =>
        import("node:fs/promises").then(({ mkdtemp }) =>
          mkdtemp(resolve(tmpdir(), "kiln-backup-archive-"))
        )
      ),
      (directory) =>
        Effect.gen(function* () {
          const config = loadConfig({
            KILN_RELAY_DATA_DIR: directory,
            KILN_RELAY_HOST: "relay.test",
            NODE_ENV: "test",
          })
          const root = resolve(directory, "instances", "instance-1")
          yield* Effect.promise(() =>
            mkdir(resolve(root, "world"), { recursive: true })
          )
          yield* Effect.promise(() =>
            writeFile(resolve(root, "world", "level.dat"), "level")
          )
          yield* Effect.promise(() =>
            writeFile(resolve(root, "session.lock"), "lock")
          )
          yield* Effect.promise(() =>
            symlink("level.dat", resolve(root, "world", "latest"))
          )

          const progress = { completed: 0, total: 0 }
          const input = backupInput(3)
          yield* Effect.promise(() =>
            mkdir(resolve(directory, "backups"), { recursive: true })
          )
          yield* Effect.promise(() =>
            writeFile(
              resolve(directory, "backups", `.${input.backupId}.stale.partial`),
              "stale"
            )
          )
          const result = yield* Effect.promise(() =>
            createPortableInstanceBackup(
              config,
              input,
              testInstance(),
              progress
            )
          )
          const archivePath = resolve(directory, "backups", result.filename)
          const archive = yield* Effect.promise(() => readFile(archivePath))
          assert.strictEqual(result.bytes, archive.byteLength)
          assert.strictEqual(
            result.checksumSha256,
            createHash("sha256").update(archive).digest("hex")
          )
          assert.strictEqual(progress.completed, 5)
          assert.deepStrictEqual(
            (yield* Effect.promise(() =>
              readdir(resolve(directory, "backups"))
            )).filter((name) => name.endsWith(".partial")),
            []
          )
          assert.include(result.warnings[0] ?? "", "world/latest")
          assert.isTrue(
            backupPathIsExcluded("session.lock", false, ["session.lock"])
          )
          assert.isTrue(
            backupPathIsExcluded("logs/debug.log", false, ["logs/**"])
          )
          assert.isFalse(
            backupPathIsExcluded("world/level.dat", false, ["logs/**"])
          )
        }),
      (directory) =>
        Effect.sync(() => rmSync(directory, { force: true, recursive: true }))
    )
  )

  it.effect("restores a verified archive through a staged directory swap", () =>
    Effect.acquireUseRelease(
      temporaryDirectory("kiln-backup-restore-"),
      (directory) =>
        Effect.gen(function* () {
          const config = testConfig(directory)
          const root = resolve(directory, "instances", "instance-1")
          yield* Effect.promise(() => mkdir(root, { recursive: true }))
          yield* Effect.promise(() =>
            writeFile(resolve(root, "server.txt"), "old")
          )
          const input = backupInput(6)
          const created = yield* Effect.promise(() =>
            createPortableInstanceBackup(config, input, testInstance(), {
              completed: 0,
              total: 0,
            })
          )
          yield* Effect.promise(() =>
            Promise.all([
              writeFile(resolve(root, "server.txt"), "new"),
              writeFile(resolve(root, "extra.txt"), "remove"),
            ])
          )
          const restore: BackupRestoreTaskInput & { kind: "restore" } = {
            backupId: input.backupId,
            bytes: created.bytes,
            checksumSha256: created.checksumSha256,
            kind: "restore",
            source: { kind: "local" },
            target: { id: "instance-1", kind: "instance" },
            taskId: "20000000-0000-4000-8000-000000000006",
          }
          const result = yield* Effect.promise(() =>
            restorePortableInstanceBackup(config, restore, testInstance())
          )
          assert.deepStrictEqual(result.warnings, [])
          assert.strictEqual(
            yield* Effect.promise(() =>
              readFile(resolve(root, "server.txt"), "utf8")
            ),
            "old"
          )
          const restored = yield* Effect.promise(() => readdir(root))
          assert.notInclude(restored, "extra.txt")
          assert.notInclude(restored, ".kiln-backup")
        }),
      removeTemporaryDirectory
    )
  )

  it.effect("finishes a journaled directory swap after Relay restart", () =>
    Effect.acquireUseRelease(
      temporaryDirectory("kiln-backup-recovery-"),
      (directory) =>
        Effect.gen(function* () {
          const config = testConfig(directory)
          const taskId = "20000000-0000-4000-8000-000000000007"
          const parent = resolve(directory, "instances")
          const staging = resolve(parent, `.instance-1.kiln-restore-${taskId}`)
          const rollback = resolve(
            parent,
            `.instance-1.kiln-rollback-${taskId}`
          )
          const journals = resolve(directory, "restores")
          yield* Effect.promise(() =>
            Promise.all([
              mkdir(staging, { recursive: true }),
              mkdir(rollback, { recursive: true }),
              mkdir(journals, { recursive: true }),
            ])
          )
          yield* Effect.promise(() =>
            Promise.all([
              writeFile(resolve(staging, "server.txt"), "restored"),
              writeFile(resolve(rollback, "server.txt"), "original"),
              writeFile(
                resolve(journals, `${taskId}.json`),
                JSON.stringify({
                  instanceDirectory: "instance-1",
                  phase: "moved_original",
                  taskId,
                  version: 1,
                })
              ),
            ])
          )
          assert.deepStrictEqual(
            yield* Effect.promise(() => recoverInterruptedRestores(config)),
            [taskId]
          )
          assert.strictEqual(
            yield* Effect.promise(() =>
              readFile(resolve(parent, "instance-1", "server.txt"), "utf8")
            ),
            "restored"
          )
          assert.notInclude(
            yield* Effect.promise(() => readdir(parent)),
            `.instance-1.kiln-rollback-${taskId}`
          )
        }),
      removeTemporaryDirectory
    )
  )

  it.effect("rejects archive paths that escape the restore staging root", () =>
    Effect.acquireUseRelease(
      temporaryDirectory("kiln-backup-traversal-"),
      (directory) =>
        Effect.gen(function* () {
          const config = testConfig(directory)
          const root = resolve(directory, "instances", "instance-1")
          const input = backupInput(8)
          const archivePath = resolve(
            directory,
            "backups",
            `${input.backupId}.zip`
          )
          yield* Effect.promise(() =>
            Promise.all([
              mkdir(root, { recursive: true }),
              mkdir(resolve(directory, "backups"), { recursive: true }),
            ])
          )
          yield* Effect.promise(() =>
            writeTestArchive(archivePath, "safe123.txt")
          )
          yield* Effect.promise(() =>
            replaceArchiveEntryName(archivePath, "safe123.txt", "../evil.txt")
          )
          const archive = yield* Effect.promise(() => readFile(archivePath))
          const failed = yield* Effect.promise(async () => {
            try {
              await restorePortableInstanceBackup(
                config,
                {
                  backupId: input.backupId,
                  bytes: archive.byteLength,
                  checksumSha256: createHash("sha256")
                    .update(archive)
                    .digest("hex"),
                  kind: "restore",
                  source: { kind: "local" },
                  target: input.target,
                  taskId: "20000000-0000-4000-8000-000000000008",
                },
                testInstance()
              )
              return false
            } catch {
              return true
            }
          })
          assert.isTrue(failed)
          assert.isFalse(existsSync(resolve(directory, "evil.txt")))
        }),
      removeTemporaryDirectory
    )
  )
})

function temporaryDirectory(prefix: string) {
  return Effect.promise(() =>
    import("node:fs/promises").then(({ mkdtemp }) =>
      mkdtemp(resolve(tmpdir(), prefix))
    )
  )
}

function removeTemporaryDirectory(directory: string) {
  return Effect.sync(() => rmSync(directory, { force: true, recursive: true }))
}

function testConfig(directory: string) {
  return loadConfig({
    KILN_RELAY_DATA_DIR: directory,
    KILN_RELAY_HOST: "relay.test",
    NODE_ENV: "test",
  })
}

function writeTestArchive(path: string, name: string): Promise<void> {
  return new Promise((resolveArchive, rejectArchive) => {
    const archive = new ZipStream({ forceZip64: true })
    const output = createWriteStream(path, { flags: "wx", mode: 0o600 })
    archive.once("error", rejectArchive)
    output.once("error", rejectArchive)
    output.once("close", resolveArchive)
    archive.pipe(output)
    archive.entry(Buffer.from("unsafe"), { name }, (cause) => {
      if (cause) rejectArchive(cause)
      else archive.finalize()
    })
  })
}

async function replaceArchiveEntryName(
  path: string,
  original: string,
  replacement: string
): Promise<void> {
  assert.strictEqual(original.length, replacement.length)
  const archive = await readFile(path)
  const source = Buffer.from(original)
  const target = Buffer.from(replacement)
  let replacements = 0
  for (let offset = archive.indexOf(source); offset !== -1;) {
    target.copy(archive, offset)
    replacements += 1
    offset = archive.indexOf(source, offset + target.length)
  }
  assert.isAtLeast(replacements, 2)
  await writeFile(path, archive)
}

function backupInput(
  index: number
): BackupCreateTaskInput & { kind: "create" } {
  const suffix = String(index).padStart(12, "0")
  return {
    artifactKind: "archive",
    backupId: `00000000-0000-4000-8000-${suffix}`,
    destination: { kind: "local" },
    exclude: [],
    kind: "create",
    maxBytes: 100 * 1024 * 1024,
    mode: "full",
    reason: "manual",
    target: { id: "instance-1", kind: "instance" },
    taskId: `10000000-0000-4000-8000-${suffix}`,
  }
}

function backupResult(index: number): BackupCreateTaskResult {
  return {
    bytes: index + 1,
    checksumSha256: String(index).repeat(64),
    filename: `backup-${index}.zip`,
    warnings: [],
  }
}

function testInstance(): RelayInstanceConfig {
  return {
    connectAddress: "relay.test",
    directory: "instance-1",
    game: "minecraft",
    id: "instance-1",
    implementation: "paper",
    javaVersion: "21",
    limits: { diskBytes: 0, memoryBytes: 0 },
    managedByRelay: true,
    name: "Instance One",
    ports: [],
    service: "kiln-instance-1",
    shortId: "instance-1",
    tailscale: { enabled: false },
    version: "1.21.8",
  }
}
