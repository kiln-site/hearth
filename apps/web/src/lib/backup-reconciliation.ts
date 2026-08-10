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
import { signS3BackupDelete, signS3BackupUpload } from "@/lib/backup-storage-s3"
import { relayRpc } from "@/lib/relay-connection"
import { listPersistedRelays, type PersistedRelay } from "@/lib/relay-registry"

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
  if (input.storageId === null) {
    if (input.objectKey !== null) {
      return yield* invalidDestination(
        "A local backup cannot have a remote object key"
      )
    }
    const { objectKey: _, storageId: __, ...task } = input
    return {
      ...task,
      destination: { kind: "local" as const },
    } satisfies BackupTaskInput
  }
  if (!input.objectKey) {
    return yield* invalidDestination(
      "An S3 backup is missing its remote object key"
    )
  }
  const storage = yield* loadBackupStorageCredentialEffect(input.storageId)
  if (!storage || (input.kind === "create" && !storage.enabled)) {
    return yield* invalidDestination("The backup destination is unavailable")
  }
  if (input.kind === "create") {
    const destination = yield* signS3BackupUpload(storage, input.objectKey)
    const { objectKey: _, storageId: __, ...task } = input
    return { ...task, destination } satisfies BackupTaskInput
  }
  const destination = yield* signS3BackupDelete(storage, input.objectKey)
  const { objectKey: _, storageId: __, ...task } = input
  return { ...task, destination } satisfies BackupTaskInput
})

function invalidDestination(reason: string) {
  return BackupStorageError.make({
    code: "invalid_backup_destination",
    operation: "backup.dispatch",
    reason,
  })
}
