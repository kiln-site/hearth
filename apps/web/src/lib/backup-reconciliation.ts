import { z } from "zod"

import { relayBackupTaskSchema } from "@workspace/contracts"
import type { BackupCreateTaskInput } from "@workspace/contracts"

import {
  listDispatchableBackupTasksEffect,
  reconcileBackupTaskEffect,
} from "@/effect/backups"
import { runAppEffect } from "@/effect/runtime"
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
  for (const task of tasks) {
    await runAppEffect("backups.reconcileTask", reconcileBackupTaskEffect(task))
  }
  const dispatchable = await runAppEffect(
    "backups.dispatchable",
    listDispatchableBackupTasksEffect(relay.id)
  )
  for (const task of dispatchable) {
    await dispatchBackupTask(relay, task, subject)
  }
}

export async function dispatchBackupTask(
  relay: PersistedRelay,
  input: BackupCreateTaskInput & { kind: "create" },
  subject?: string
): Promise<void> {
  const task = relayBackupTaskSchema.parse(
    await relayRpc(relay, "backup.task.enqueue", input, 15_000, subject)
  )
  await runAppEffect(
    "backups.reconcileEnqueue",
    reconcileBackupTaskEffect(task)
  )
}
