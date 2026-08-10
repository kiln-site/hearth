import { z } from "zod"
import { Effect } from "effect"

import { relayBackupTaskSchema } from "@workspace/contracts"
import type { BackupTaskInput } from "@workspace/contracts"

import {
  listDispatchableBackupTasksEffect,
  reconcileBackupTaskEffect,
  type BackupDispatch,
} from "@/effect/backups"
import { loadBackupStorageCredentialEffect } from "@/effect/backup-storage"
import { BackupStorageError } from "@/effect/errors"
import { runAppEffect } from "@/effect/runtime"
import {
  signS3BackupDelete,
  signS3BackupRestore,
  signS3BackupUpload,
} from "@/lib/backup-storage-s3"
import { relayRpc } from "@/lib/relay-connection"
import { listPersistedRelays, type PersistedRelay } from "@/lib/relay-registry"

const reconciliationTimers = new Map<string, ReturnType<typeof setTimeout>>()

export async function reconcileBackupsAfterRelayConnect(
  relayId: string
): Promise<void> {
  const relay = (await listPersistedRelays()).find(
    (candidate) => candidate.enabled && candidate.id === relayId
  )
  if (relay) await reconcileRelayBackups(relay)
}

export async function reconcileRelayBackups(
  relay: PersistedRelay,
  subject?: string
): Promise<void> {
  // Import Relay state first so interrupted tasks can be refreshed and
  // redispatched during this same reconciliation pass.
  const tasks = z
    .array(relayBackupTaskSchema)
    .parse(await relayRpc(relay, "backup.task.list", {}, 15_000, subject))
  const relayTasksById = new Map(tasks.map((task) => [task.taskId, task]))
  for (const task of tasks) {
    await runAppEffect("backups.reconcileTask", reconcileBackupTaskEffect(task))
  }
  const dispatchable = await runAppEffect(
    "backups.dispatchable",
    listDispatchableBackupTasksEffect(relay.id)
  )
  for (const task of dispatchable) {
    const relayTask = relayTasksById.get(task.taskId)
    if (relayTask && !relayTask.inputRefreshRequired) continue
    await dispatchBackupTask(relay, task, subject)
  }
  const [instanceDeletion, databaseDeletion] = await Promise.all([
    import("@/lib/final-instance-deletion"),
    import("@/lib/final-database-deletion"),
  ])
  const [instancesPending, databasesPending] = await Promise.all([
    instanceDeletion.processFinalInstanceDeletions(relay),
    databaseDeletion.processFinalDatabaseDeletions(relay),
  ])
  if (
    instancesPending ||
    databasesPending ||
    dispatchable.length > 0 ||
    tasks.some((task) => task.status === "queued" || task.status === "running")
  ) {
    scheduleBackupReconciliation(relay, subject)
  }
}

export async function dispatchBackupTask(
  relay: PersistedRelay,
  input: BackupDispatch,
  subject?: string
): Promise<void> {
  const relayInput = await runAppEffect(
    "backups.prepareDispatch",
    prepareBackupTaskEffect(input)
  )
  const task = relayBackupTaskSchema.parse(
    await relayRpc(relay, "backup.task.enqueue", relayInput, 15_000, subject)
  )
  await runAppEffect(
    "backups.reconcileEnqueue",
    reconcileBackupTaskEffect(task)
  )
}

const prepareBackupTaskEffect = Effect.fn("backups.prepareTask")(function* (
  input: BackupDispatch
) {
  if (input.kind === "create" || input.kind === "delete") {
    if (input.artifacts.length === 0) {
      return yield* invalidDestination("The backup has no stored artifacts")
    }
    const destinations: Array<
      Extract<BackupTaskInput, { kind: typeof input.kind }>["destination"]
    > = []
    for (const artifact of input.artifacts) {
      if (artifact.storageId === null) {
        if (artifact.objectKey !== null) {
          return yield* invalidDestination(
            "A local backup cannot have a remote object key"
          )
        }
        destinations.push({ artifactId: artifact.artifactId, kind: "local" })
        continue
      }
      if (!artifact.objectKey) {
        return yield* invalidDestination(
          "An S3 backup is missing its remote object key"
        )
      }
      const storage = yield* loadBackupStorageCredentialEffect(
        artifact.storageId
      )
      if (!storage || (input.kind === "create" && !storage.enabled)) {
        return yield* invalidDestination(
          "The backup destination is unavailable"
        )
      }
      destinations.push(
        input.kind === "create"
          ? {
              ...(yield* signS3BackupUpload(storage, artifact.objectKey)),
              artifactId: artifact.artifactId,
            }
          : {
              ...(yield* signS3BackupDelete(storage, artifact.objectKey)),
              artifactId: artifact.artifactId,
            }
      )
    }
    const [destination, ...replicas] = destinations
    if (!destination) {
      return yield* invalidDestination("The backup has no stored artifacts")
    }
    const { artifacts: _, ...task } = input
    return {
      ...task,
      destination,
      replicas,
    } as BackupTaskInput
  }
  if (input.storageId === null) {
    if (input.objectKey !== null) {
      return yield* invalidDestination(
        "A local backup cannot have a remote object key"
      )
    }
    const { artifactId: _, objectKey: __, storageId: ___, ...task } = input
    return {
      ...task,
      source: { kind: "local" as const },
    } satisfies BackupTaskInput
  }
  if (!input.objectKey) {
    return yield* invalidDestination(
      "An S3 backup is missing its remote object key"
    )
  }
  const storage = yield* loadBackupStorageCredentialEffect(input.storageId)
  if (!storage) {
    return yield* invalidDestination("The backup destination is unavailable")
  }
  const source = yield* signS3BackupRestore(storage, input.objectKey)
  const { artifactId: _, objectKey: __, storageId: ___, ...task } = input
  return { ...task, source } satisfies BackupTaskInput
})

function invalidDestination(reason: string) {
  return BackupStorageError.make({
    code: "invalid_backup_destination",
    operation: "backup.dispatch",
    reason,
  })
}

export function scheduleBackupReconciliation(
  relay: PersistedRelay,
  subject?: string
): void {
  if (reconciliationTimers.has(relay.id)) return
  const timer = setTimeout(() => {
    reconciliationTimers.delete(relay.id)
    void Effect.runPromise(
      Effect.tryPromise({
        try: () => reconcileRelayBackups(relay, subject),
        catch: (cause) => cause,
      }).pipe(
        Effect.catch((cause) =>
          Effect.sync(() => {
            console.error(
              `Could not continue backup reconciliation on Relay ${relay.id}`,
              cause
            )
            scheduleBackupReconciliation(relay, subject)
          })
        )
      )
    )
  }, 1_000)
  timer.unref()
  reconciliationTimers.set(relay.id, timer)
}
