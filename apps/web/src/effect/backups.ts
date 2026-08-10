import { randomUUID } from "node:crypto"
import type { RowDataPacket } from "mysql2/promise"
import { Effect } from "effect"

import type {
  BackupCreateTaskInput,
  BackupDeleteTaskInput,
  BackupRestoreTaskInput,
  BackupTaskStatus,
  RelayBackupTask,
} from "@workspace/contracts"

import { Database } from "@/effect/database"
import { BackupLimitError, BackupStorageError } from "@/effect/errors"
import { databaseTable } from "@/lib/database-config"
import { kilnInstallationId } from "@/lib/environment"
import { backupObjectKey } from "@/lib/backup-storage-s3"

interface BackupPolicyRow extends RowDataPacket {
  admin_quantity_limit: number | null
  admin_size_limit_bytes: number | string | null
  exclude_patterns: unknown
  quantity_limit: number | null
  size_limit_bytes: number | string | null
  storage_id: string | null
}

interface BackupStorageKeyRow extends RowDataPacket {
  id: string
  object_prefix: string
  owner_user_id: string | null
}

interface BackupArtifactRow extends RowDataPacket {
  backup_id: string
  bytes: number | string | null
  checksum_sha256: string | null
  error: string | null
  filename: string | null
  id: string
  object_key: string | null
  status: "available" | "deleted" | "deleting" | "failed" | "queued" | "running"
  storage_id: string | null
}

interface BackupUsageRow extends RowDataPacket {
  quantity_used: number | string
  size_used: number | string
}

interface BackupRow extends RowDataPacket {
  artifact_kind: "archive" | "database_dump" | "platform_bundle"
  backup_mode: "full" | "incremental"
  bytes: number | string | null
  checksum_sha256: string | null
  completed_at_ms: number | string | null
  created_by: string | null
  created_at_ms: number | string
  filename: string | null
  id: string
  name: string
  reason: "final_delete" | "manual" | "pre_restore" | "scheduled"
  relay_id: string
  object_key: string | null
  storage_id: string | null
  status: "available" | "deleted" | "deleting" | "failed" | "queued" | "running"
  target_id: string
  target_kind: "database" | "instance" | "platform"
  task_error: string | null
  task_id: string
  task_status: "cancelled" | "failed" | "queued" | "running" | "succeeded"
  warnings: unknown
}

interface DispatchableBackupRow extends RowDataPacket {
  artifact_kind: BackupRow["artifact_kind"]
  backup_id: string
  backup_mode: "full"
  bytes: number | string | null
  checksum_sha256: string | null
  exclude_patterns: unknown
  object_key: string | null
  reason: BackupCreateTaskInput["reason"]
  reserved_bytes: number | string | null
  storage_id: string | null
  target_id: string
  target_kind: BackupRow["target_kind"]
  task_id: string
  task_kind: "create" | "delete" | "restore"
}

interface KnownBackupTaskRow extends RowDataPacket {
  bytes_completed: number | string
  id: string
  relay_updated_at_ms: number | string | null
  status: BackupTaskStatus
}

interface BackupTaskReconcileState {
  bytesCompleted: number
  relayUpdatedAt: number | null
  status: BackupTaskStatus
}

interface FinalInstanceDeletionRow extends RowDataPacket {
  backup_id: string
  backup_status: BackupRow["status"]
  error: string | null
  relay_id: string
  requested_by: string
  status: "backing_up" | "completed" | "deleting" | "failed"
  target_id: string
  task_error: string | null
}

type FinalDatabaseDeletionRow = FinalInstanceDeletionRow

export interface FinalInstanceDeletion {
  backupId: string
  backupStatus: BackupRow["status"]
  error: string | null
  relayId: string
  requestedBy: string
  status: FinalInstanceDeletionRow["status"]
  targetId: string
  taskError: string | null
}

export type FinalDatabaseDeletion = FinalInstanceDeletion

export interface BackupCatalogRecord {
  artifacts: Array<BackupArtifactRecord>
  artifactKind: BackupRow["artifact_kind"]
  backupMode: BackupRow["backup_mode"]
  bytes: number | null
  checksumSha256: string | null
  completedAt: string | null
  createdBy: string | null
  createdAt: string
  filename: string | null
  id: string
  name: string
  objectKey: string | null
  reason: BackupRow["reason"]
  relayId: string
  status: BackupRow["status"]
  storageId: string | null
  targetId: string
  targetKind: BackupRow["target_kind"]
  taskError: string | null
  taskId: string
  taskStatus: BackupRow["task_status"]
  warnings: Array<string>
}

export interface BackupArtifactRecord {
  bytes: number | null
  checksumSha256: string | null
  error: string | null
  filename: string | null
  id: string
  objectKey: string | null
  status: BackupArtifactRow["status"]
  storageId: string | null
}

export interface BackupDispatchArtifact {
  artifactId: string
  objectKey: string | null
  storageId: string | null
}

export interface InstanceBackupPolicy {
  adminQuantityLimit: number | null
  adminSizeLimitBytes: number | null
  exclude: Array<string>
  quantityLimit: number | null
  sizeLimitBytes: number | null
  storageId: string | null
}

export interface BackupCreateDispatch extends Omit<
  BackupCreateTaskInput,
  "destination" | "replicas"
> {
  artifacts: Array<BackupDispatchArtifact>
  kind: "create"
}

export interface BackupDeleteDispatch extends Omit<
  BackupDeleteTaskInput,
  "destination" | "replicas"
> {
  artifacts: Array<BackupDispatchArtifact>
  kind: "delete"
}

export interface BackupRestoreDispatch extends Omit<
  BackupRestoreTaskInput,
  "source"
> {
  artifactId: string
  kind: "restore"
  objectKey: string | null
  storageId: string | null
}

export type BackupDispatch =
  | BackupCreateDispatch
  | BackupDeleteDispatch
  | BackupRestoreDispatch

const reserveBackupCreateEffect = Effect.fn("backups.reserveCreate")(
  function* (input: {
    artifactKind: BackupCreateTaskInput["artifactKind"]
    backupId: string
    createdBy: string
    exclude: ReadonlyArray<string>
    name: string
    reason?: BackupCreateTaskInput["reason"]
    relayId: string
    requestedMaxBytes: number | null
    storageId?: string | null
    storageIds?: ReadonlyArray<string | null>
    targetId: string
    targetKind: BackupCreateTaskInput["target"]["kind"]
    taskId: string
  }) {
    const database = yield* Database
    return yield* database.transaction("backup_reserve", (transaction) =>
      Effect.gen(function* () {
        yield* transaction.execute(
          `INSERT IGNORE INTO ${databaseTable("backup_policy")}
            (relay_id, target_kind, target_id, exclude_patterns)
           VALUES (?, ?, ?, ?)`,
          [
            input.relayId,
            input.targetKind,
            input.targetId,
            JSON.stringify(input.exclude),
          ]
        )
        const policies = yield* transaction.queryRows<BackupPolicyRow>(
          `SELECT exclude_patterns, quantity_limit, size_limit_bytes, storage_id,
                  admin_quantity_limit, admin_size_limit_bytes
             FROM ${databaseTable("backup_policy")}
            WHERE relay_id = ? AND target_kind = ? AND target_id = ?
            FOR UPDATE`,
          [input.relayId, input.targetKind, input.targetId]
        )
        const policy = policies[0]
        if (!policy) return yield* Effect.die("Backup policy was not created")
        if (input.reason === "final_delete") {
          const activeRestores =
            yield* transaction.queryRows<KnownBackupTaskRow>(
              `SELECT task.id
                 FROM ${databaseTable("backup_task")} task
                 JOIN ${databaseTable("backup")} backup ON backup.id = task.backup_id
                WHERE backup.relay_id = ?
                  AND backup.target_kind = ?
                  AND backup.target_id = ?
                  AND task.task_kind = 'restore'
                  AND task.status IN ('queued', 'running')
                LIMIT 1`,
              [input.relayId, input.targetKind, input.targetId]
            )
          if (activeRestores[0]) {
            return yield* BackupStorageError.make({
              code: "restore_in_progress",
              operation: "backup.finalDelete",
              reason:
                "Wait for the active restore before deleting this resource",
            })
          }
        }
        const selectedStorageIds = deduplicateStorageIds(
          input.storageIds ?? [
            input.storageId === undefined ? policy.storage_id : input.storageId,
          ]
        )
        if (selectedStorageIds.length === 0) {
          return yield* BackupStorageError.make({
            code: "storage_unavailable",
            operation: "backup.reserve",
            reason: "Choose at least one backup destination",
          })
        }
        const artifacts: Array<BackupDispatchArtifact> = []
        for (const storageId of selectedStorageIds) {
          const storage = storageId
            ? (yield* transaction.queryRows<BackupStorageKeyRow>(
                `SELECT id, object_prefix, owner_user_id
                     FROM ${databaseTable("backup_storage")}
                    WHERE id = ? AND enabled = TRUE
                    LIMIT 1`,
                [storageId]
              ))[0]
            : null
          if (
            storageId &&
            (!storage ||
              (storage.owner_user_id !== null &&
                storage.owner_user_id !== input.createdBy))
          ) {
            return yield* BackupStorageError.make({
              code: "storage_unavailable",
              operation: "backup.reserve",
              reason: "A selected backup destination is unavailable",
            })
          }
          artifacts.push({
            artifactId: randomUUID(),
            objectKey: storage
              ? backupObjectKey({
                  backupId: input.backupId,
                  installationId: kilnInstallationId(),
                  objectPrefix: storage.object_prefix,
                  relayId: input.relayId,
                  targetId: input.targetId,
                  targetKind: input.targetKind,
                })
              : null,
            storageId,
          })
        }
        const primaryArtifact = artifacts[0]
        if (!primaryArtifact) return yield* Effect.die("Backup has no artifact")
        const usageRows = yield* transaction.queryRows<BackupUsageRow>(
          `SELECT COUNT(*) AS quantity_used,
                  COALESCE(SUM(
                    CASE
                      WHEN backup.status IN ('available', 'deleting')
                        THEN COALESCE(backup.bytes, 0)
                      ELSE COALESCE((
                        SELECT MAX(task.reserved_bytes)
                          FROM ${databaseTable("backup_task")} task
                         WHERE task.backup_id = backup.id
                           AND task.task_kind = 'create'
                           AND task.status IN ('queued', 'running')
                      ), 0)
                    END
                  ), 0) AS size_used
             FROM ${databaseTable("backup")} backup
            WHERE backup.relay_id = ?
              AND backup.target_kind = ?
              AND backup.target_id = ?
              AND backup.status IN ('queued', 'running', 'available', 'deleting')`,
          [input.relayId, input.targetKind, input.targetId]
        )
        const usage = usageRows[0]
        const quantityUsed = safeDatabaseNumber(
          usage?.quantity_used ?? 0,
          "backup quantity"
        )
        const sizeUsed = safeDatabaseNumber(
          usage?.size_used ?? 0,
          "backup size"
        )
        const userQuantityLimit =
          input.reason === "final_delete" ? null : policy.quantity_limit
        const userSizeLimit =
          input.reason === "final_delete"
            ? null
            : nullableDatabaseNumber(
                policy.size_limit_bytes,
                "backup size limit"
              )
        const quantityLimit = effectiveBackupLimit(
          userQuantityLimit,
          policy.admin_quantity_limit
        )
        const sizeLimit = effectiveBackupLimit(
          userSizeLimit,
          nullableDatabaseNumber(
            policy.admin_size_limit_bytes,
            "admin backup size limit"
          )
        )
        const reservation = yield* Effect.try({
          try: () =>
            backupReservation({
              quantityLimit,
              quantityUsed,
              requestedMaxBytes: input.requestedMaxBytes,
              sizeLimit,
              sizeUsed,
            }),
          catch: (cause) =>
            cause instanceof BackupLimitError
              ? cause
              : BackupStorageError.make({
                  cause,
                  code: "reservation_failed",
                  operation: "backup.reserve",
                  reason: "The backup reservation could not be calculated",
                }),
        })

        yield* transaction.execute(
          `INSERT INTO ${databaseTable("backup")}
            (id, relay_id, target_kind, target_id, storage_id, artifact_kind,
             backup_mode, reason, status, name, object_key, warnings, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'full', ?,
                   'queued', ?, ?, JSON_ARRAY(), ?)`,
          [
            input.backupId,
            input.relayId,
            input.targetKind,
            input.targetId,
            primaryArtifact.storageId,
            input.artifactKind,
            input.reason ?? "manual",
            input.name,
            primaryArtifact.objectKey,
            input.createdBy,
          ]
        )
        for (const artifact of artifacts) {
          yield* transaction.execute(
            `INSERT INTO ${databaseTable("backup_artifact")}
              (id, backup_id, destination_key, storage_id, status, object_key)
             VALUES (?, ?, ?, ?, 'queued', ?)`,
            [
              artifact.artifactId,
              input.backupId,
              artifact.storageId ?? "local",
              artifact.storageId,
              artifact.objectKey,
            ]
          )
        }
        yield* transaction.execute(
          `INSERT INTO ${databaseTable("backup_task")}
            (id, backup_id, task_kind, status, reserved_bytes, requested_by)
           VALUES (?, ?, 'create', 'queued', ?, ?)`,
          [input.taskId, input.backupId, reservation.maxBytes, input.createdBy]
        )
        if (
          input.reason === "final_delete" &&
          input.targetKind === "instance"
        ) {
          yield* transaction.execute(
            `INSERT INTO ${databaseTable("backup_final_delete")}
              (relay_id, target_id, backup_id, requested_by, status)
             VALUES (?, ?, ?, ?, 'backing_up')`,
            [input.relayId, input.targetId, input.backupId, input.createdBy]
          )
        }
        if (
          input.reason === "final_delete" &&
          input.targetKind === "database"
        ) {
          yield* transaction.execute(
            `INSERT INTO ${databaseTable("backup_final_database_delete")}
              (relay_id, target_id, backup_id, requested_by, status)
             VALUES (?, ?, ?, ?, 'backing_up')`,
            [input.relayId, input.targetId, input.backupId, input.createdBy]
          )
        }
        return {
          artifacts,
          artifactKind: input.artifactKind,
          backupId: input.backupId,
          exclude: parseExcludes(policy.exclude_patterns),
          kind: "create",
          maxBytes: reservation.maxBytes,
          mode: "full",
          reason: input.reason ?? "manual",
          target: { id: input.targetId, kind: input.targetKind },
          taskId: input.taskId,
        } satisfies BackupCreateDispatch
      })
    )
  }
)

export const reserveInstanceBackupEffect = Effect.fn("backups.reserve")(
  (input: {
    backupId: string
    createdBy: string
    name: string
    reason?: BackupCreateTaskInput["reason"]
    relayId: string
    requestedMaxBytes: number | null
    storageId?: string | null
    storageIds?: ReadonlyArray<string | null>
    targetId: string
    taskId: string
  }) =>
    reserveBackupCreateEffect({
      ...input,
      artifactKind: "archive",
      exclude: [],
      targetKind: "instance",
    })
)

export const reserveDatabaseBackupEffect = Effect.fn("backups.reserveDatabase")(
  (input: {
    backupId: string
    createdBy: string
    name: string
    reason?: BackupCreateTaskInput["reason"]
    relayId: string
    requestedMaxBytes: number | null
    storageId?: string | null
    storageIds?: ReadonlyArray<string | null>
    targetId: string
    taskId: string
  }) =>
    reserveBackupCreateEffect({
      ...input,
      artifactKind: "database_dump",
      exclude: [],
      targetKind: "database",
    })
)

export const reservePlatformBackupEffect = Effect.fn("backups.reservePlatform")(
  (input: {
    backupId: string
    createdBy: string
    name: string
    relayId: string
    requestedMaxBytes: number | null
    storageId?: string | null
    storageIds?: ReadonlyArray<string | null>
    targetId: string
    taskId: string
  }) =>
    reserveBackupCreateEffect({
      ...input,
      artifactKind: "platform_bundle",
      exclude: [],
      targetKind: "platform",
    })
)

export const reconcileBackupTaskEffect = Effect.fn("backups.reconcile")(
  function* (task: RelayBackupTask) {
    const database = yield* Database
    yield* database.transaction("backup_reconcile", (transaction) =>
      Effect.gen(function* () {
        const knownTasks = yield* transaction.queryRows<KnownBackupTaskRow>(
          `SELECT task.id, task.status, task.bytes_completed,
                  task.relay_updated_at_ms
             FROM ${databaseTable("backup_task")} task
             JOIN ${databaseTable("backup")} backup ON backup.id = task.backup_id
            WHERE task.id = ? AND task.backup_id = ?
            FOR UPDATE`,
          [task.taskId, task.backupId]
        )
        const knownTask = knownTasks[0]
        if (!knownTask) return
        if (
          !shouldApplyRelayBackupTaskSnapshot(
            {
              bytesCompleted: safeDatabaseNumber(
                knownTask.bytes_completed,
                "backup task progress"
              ),
              relayUpdatedAt: nullableDatabaseNumber(
                knownTask.relay_updated_at_ms,
                "Relay backup task update time"
              ),
              status: knownTask.status,
            },
            task
          )
        ) {
          return
        }
        yield* transaction.execute(
          `UPDATE ${databaseTable("backup_task")}
              SET status = ?, bytes_completed = ?, bytes_total = ?, error = ?,
                  started_at = FROM_UNIXTIME(? / 1000),
                  finished_at = FROM_UNIXTIME(? / 1000),
                  relay_updated_at_ms = ?
            WHERE id = ? AND backup_id = ?`,
          [
            task.status,
            task.bytesCompleted,
            task.bytesTotal,
            task.error,
            task.startedAt,
            task.finishedAt,
            task.updatedAt,
            task.taskId,
            task.backupId,
          ]
        )
        if (task.kind === "delete") {
          if (task.status === "queued" || task.status === "running") {
            yield* transaction.execute(
              `UPDATE ${databaseTable("backup")}
                  SET status = 'deleting'
                WHERE id = ?`,
              [task.backupId]
            )
            yield* transaction.execute(
              `UPDATE ${databaseTable("backup_artifact")}
                  SET status = 'deleting'
                WHERE backup_id = ? AND status <> 'deleted'`,
              [task.backupId]
            )
          } else if (task.status === "succeeded") {
            const outcomes = task.result?.artifacts ?? []
            if (outcomes.length === 0) {
              yield* transaction.execute(
                `UPDATE ${databaseTable("backup_artifact")}
                    SET status = 'deleted', deleted_at = FROM_UNIXTIME(? / 1000)
                  WHERE backup_id = ?`,
                [task.finishedAt ?? Date.now(), task.backupId]
              )
            } else {
              for (const outcome of outcomes) {
                yield* transaction.execute(
                  `UPDATE ${databaseTable("backup_artifact")}
                      SET status = ?, error = ?,
                          deleted_at = CASE WHEN ? = 'deleted'
                            THEN FROM_UNIXTIME(? / 1000) ELSE NULL END
                    WHERE id = ? AND backup_id = ?`,
                  [
                    outcome.status,
                    outcome.error,
                    outcome.status,
                    task.finishedAt ?? Date.now(),
                    outcome.artifactId,
                    task.backupId,
                  ]
                )
              }
            }
            const remaining = yield* transaction.queryRows<RowDataPacket>(
              `SELECT id FROM ${databaseTable("backup_artifact")}
                WHERE backup_id = ? AND status <> 'deleted' LIMIT 1`,
              [task.backupId]
            )
            yield* transaction.execute(
              `UPDATE ${databaseTable("backup")}
                  SET status = ?,
                      deleted_at = CASE WHEN ? = 'deleted'
                        THEN FROM_UNIXTIME(? / 1000) ELSE NULL END
                WHERE id = ?`,
              [
                remaining[0] ? "available" : "deleted",
                remaining[0] ? "available" : "deleted",
                task.finishedAt ?? Date.now(),
                task.backupId,
              ]
            )
          } else if (task.status === "failed" || task.status === "cancelled") {
            yield* transaction.execute(
              `UPDATE ${databaseTable("backup")}
                  SET status = 'available'
                WHERE id = ?`,
              [task.backupId]
            )
            yield* transaction.execute(
              `UPDATE ${databaseTable("backup_artifact")}
                  SET status = 'available'
                WHERE backup_id = ? AND status = 'deleting'`,
              [task.backupId]
            )
          }
          return
        }
        if (task.kind !== "create") return
        if (task.status === "queued" || task.status === "running") {
          yield* transaction.execute(
            `UPDATE ${databaseTable("backup")}
                SET status = ?,
                    started_at = COALESCE(started_at, FROM_UNIXTIME(? / 1000))
              WHERE id = ?`,
            [task.status, task.startedAt, task.backupId]
          )
          yield* transaction.execute(
            `UPDATE ${databaseTable("backup_artifact")}
                SET status = ?
              WHERE backup_id = ? AND status IN ('queued', 'running')`,
            [task.status, task.backupId]
          )
          return
        }
        if (
          task.status === "succeeded" &&
          task.result &&
          "bytes" in task.result
        ) {
          const outcomes = task.result.artifacts ?? []
          if (outcomes.length === 0) {
            yield* transaction.execute(
              `UPDATE ${databaseTable("backup_artifact")}
                  SET status = 'available', filename = ?, bytes = ?,
                      checksum_sha256 = ?, error = NULL,
                      completed_at = FROM_UNIXTIME(? / 1000)
                WHERE backup_id = ?`,
              [
                task.result.filename,
                task.result.bytes,
                task.result.checksumSha256,
                task.finishedAt ?? Date.now(),
                task.backupId,
              ]
            )
          } else {
            for (const outcome of outcomes) {
              yield* transaction.execute(
                `UPDATE ${databaseTable("backup_artifact")}
                    SET status = ?, filename = ?,
                        bytes = CASE WHEN ? = 'available' THEN ? ELSE NULL END,
                        checksum_sha256 = CASE WHEN ? = 'available' THEN ? ELSE NULL END,
                        error = ?, completed_at = FROM_UNIXTIME(? / 1000)
                  WHERE id = ? AND backup_id = ?`,
                [
                  outcome.status,
                  task.result.filename,
                  outcome.status,
                  task.result.bytes,
                  outcome.status,
                  task.result.checksumSha256,
                  outcome.error,
                  task.finishedAt ?? Date.now(),
                  outcome.artifactId,
                  task.backupId,
                ]
              )
            }
          }
          const available = yield* transaction.queryRows<RowDataPacket>(
            `SELECT id FROM ${databaseTable("backup_artifact")}
              WHERE backup_id = ? AND status = 'available' LIMIT 1`,
            [task.backupId]
          )
          yield* transaction.execute(
            `UPDATE ${databaseTable("backup")}
                SET status = ?, filename = ?, bytes = ?,
                    checksum_sha256 = ?, warnings = ?,
                    completed_at = FROM_UNIXTIME(? / 1000)
              WHERE id = ?`,
            [
              available[0] ? "available" : "failed",
              task.result.filename,
              task.result.bytes,
              task.result.checksumSha256,
              JSON.stringify(task.result.warnings),
              task.finishedAt ?? Date.now(),
              task.backupId,
            ]
          )
          return
        }
        if (task.status === "failed" || task.status === "cancelled") {
          yield* transaction.execute(
            `UPDATE ${databaseTable("backup")}
                SET status = 'failed',
                    completed_at = FROM_UNIXTIME(? / 1000)
              WHERE id = ?`,
            [task.finishedAt ?? Date.now(), task.backupId]
          )
          yield* transaction.execute(
            `UPDATE ${databaseTable("backup_artifact")}
                SET status = 'failed', error = ?,
                    completed_at = FROM_UNIXTIME(? / 1000)
              WHERE backup_id = ? AND status IN ('queued', 'running')`,
            [task.error, task.finishedAt ?? Date.now(), task.backupId]
          )
        }
      })
    )
  }
)

export const listBackupCatalogEffect = Effect.fn("backups.list")(function* () {
  const database = yield* Database
  const rows = yield* database.queryRows<BackupRow>(
    "backup_catalog_list",
    `SELECT backup.id, backup.relay_id, backup.target_kind, backup.target_id,
            backup.artifact_kind, backup.backup_mode, backup.reason,
            backup.status, backup.name, backup.filename, backup.bytes,
            backup.checksum_sha256, backup.warnings, backup.created_by,
            backup.storage_id,
            backup.object_key,
            ROUND(UNIX_TIMESTAMP(backup.completed_at) * 1000) AS completed_at_ms,
            ROUND(UNIX_TIMESTAMP(backup.created_at) * 1000) AS created_at_ms,
            task.id AS task_id, task.status AS task_status,
            task.error AS task_error
       FROM ${databaseTable("backup")} backup
       JOIN ${databaseTable("backup_task")} task ON task.id = (
         SELECT latest.id
           FROM ${databaseTable("backup_task")} latest
          WHERE latest.backup_id = backup.id
          ORDER BY latest.created_at DESC, latest.id DESC
          LIMIT 1
       )
      WHERE backup.status <> 'deleted'
      ORDER BY backup.created_at DESC, backup.id DESC`
  )
  const artifactRows = yield* database.queryRows<BackupArtifactRow>(
    "backup_artifact_catalog_list",
    `SELECT artifact.id, artifact.backup_id, artifact.storage_id,
            artifact.status, artifact.filename, artifact.object_key,
            artifact.bytes, artifact.checksum_sha256, artifact.error
       FROM ${databaseTable("backup_artifact")} artifact
       JOIN ${databaseTable("backup")} backup ON backup.id = artifact.backup_id
      WHERE backup.status <> 'deleted' AND artifact.status <> 'deleted'
      ORDER BY artifact.created_at ASC, artifact.id ASC`
  )
  const artifactsByBackup = new Map<string, Array<BackupArtifactRecord>>()
  for (const artifact of artifactRows) {
    const records = artifactsByBackup.get(artifact.backup_id) ?? []
    records.push({
      bytes: nullableDatabaseNumber(artifact.bytes, "backup artifact bytes"),
      checksumSha256: artifact.checksum_sha256,
      error: artifact.error,
      filename: artifact.filename,
      id: artifact.id,
      objectKey: artifact.object_key,
      status: artifact.status,
      storageId: artifact.storage_id,
    })
    artifactsByBackup.set(artifact.backup_id, records)
  }
  return rows.map((row) => ({
    artifacts: artifactsByBackup.get(row.id) ?? [],
    artifactKind: row.artifact_kind,
    backupMode: row.backup_mode,
    bytes: nullableDatabaseNumber(row.bytes, "backup bytes"),
    checksumSha256: row.checksum_sha256,
    completedAt: timestampIso(row.completed_at_ms, "backup completed at"),
    createdBy: row.created_by,
    createdAt: requiredTimestampIso(row.created_at_ms, "backup created at"),
    filename: row.filename,
    id: row.id,
    name: row.name,
    objectKey: row.object_key,
    reason: row.reason,
    relayId: row.relay_id,
    status: row.status,
    storageId: row.storage_id,
    targetId: row.target_id,
    targetKind: row.target_kind,
    taskError: row.task_error,
    taskId: row.task_id,
    taskStatus: row.task_status,
    warnings: parseWarnings(row.warnings),
  })) satisfies Array<BackupCatalogRecord>
})

export const listDispatchableBackupTasksEffect = Effect.fn(
  "backups.dispatchable"
)(function* (relayId: string) {
  const database = yield* Database
  yield* database.execute(
    "backup_dependency_failures",
    `UPDATE ${databaseTable("backup_task")} dependent
       JOIN ${databaseTable("backup_task")} dependency
         ON dependency.id = dependent.depends_on_task_id
        SET dependent.status = 'failed',
            dependent.error = 'The pre-restore safety backup did not complete',
            dependent.finished_at = CURRENT_TIMESTAMP(3)
      WHERE dependent.status = 'queued'
        AND dependent.task_kind = 'restore'
        AND dependency.status IN ('failed', 'cancelled')`
  )
  const rows = yield* database.queryRows<DispatchableBackupRow>(
    "backup_dispatchable_list",
    `SELECT backup.id AS backup_id, backup.target_kind, backup.target_id,
            backup.artifact_kind, backup.backup_mode, backup.reason,
            backup.bytes, backup.checksum_sha256,
            task.id AS task_id, task.task_kind, task.reserved_bytes,
            backup.storage_id, backup.object_key,
            COALESCE(policy.exclude_patterns, JSON_ARRAY()) AS exclude_patterns
       FROM ${databaseTable("backup")} backup
       JOIN ${databaseTable("backup_task")} task
         ON task.backup_id = backup.id
        AND task.task_kind IN ('create', 'restore', 'delete')
       LEFT JOIN ${databaseTable("backup_policy")} policy
         ON policy.relay_id = backup.relay_id
        AND policy.target_kind = backup.target_kind
        AND policy.target_id = backup.target_id
      WHERE backup.relay_id = ?
        AND backup.backup_mode = 'full'
        AND ((backup.target_kind = 'instance' AND backup.artifact_kind = 'archive')
          OR (backup.target_kind = 'database' AND backup.artifact_kind = 'database_dump')
          OR (backup.target_kind = 'platform' AND backup.artifact_kind = 'platform_bundle'))
        AND ((task.task_kind = 'create' AND backup.status = 'queued')
          OR (task.task_kind = 'restore' AND backup.status = 'available')
          OR (task.task_kind = 'delete' AND backup.status = 'deleting'))
        AND task.status = 'queued'
        AND (task.depends_on_task_id IS NULL OR EXISTS (
          SELECT 1
            FROM ${databaseTable("backup_task")} dependency
           WHERE dependency.id = task.depends_on_task_id
             AND dependency.status = 'succeeded'
        ))
      ORDER BY task.created_at ASC, task.id ASC`,
    [relayId]
  )
  const artifactRows = yield* database.queryRows<BackupArtifactRow>(
    "backup_dispatchable_artifacts",
    `SELECT artifact.id, artifact.backup_id, artifact.storage_id,
            artifact.status, artifact.filename, artifact.object_key,
            artifact.bytes, artifact.checksum_sha256, artifact.error
       FROM ${databaseTable("backup_artifact")} artifact
       JOIN ${databaseTable("backup")} backup ON backup.id = artifact.backup_id
      WHERE backup.relay_id = ? AND artifact.status <> 'deleted'
      ORDER BY (artifact.storage_id IS NULL) DESC, artifact.created_at ASC`,
    [relayId]
  )
  const artifactsByBackup = new Map<string, Array<BackupArtifactRow>>()
  for (const artifact of artifactRows) {
    const artifacts = artifactsByBackup.get(artifact.backup_id) ?? []
    artifacts.push(artifact)
    artifactsByBackup.set(artifact.backup_id, artifacts)
  }
  return rows.map((row): BackupDispatch => {
    const artifacts = artifactsByBackup.get(row.backup_id) ?? []
    if (row.task_kind === "restore") {
      const artifact = artifacts.find(
        (candidate) => candidate.status === "available"
      )
      const bytes = nullableDatabaseNumber(
        artifact?.bytes ?? null,
        "backup artifact bytes"
      )
      if (!artifact || bytes === null || !artifact.checksum_sha256) {
        throw new Error(
          "Available backup is missing restore integrity metadata"
        )
      }
      return {
        backupId: row.backup_id,
        bytes,
        checksumSha256: artifact.checksum_sha256,
        artifactId: artifact.id,
        kind: "restore",
        objectKey: artifact.object_key,
        storageId: artifact.storage_id,
        target: { id: row.target_id, kind: row.target_kind },
        taskId: row.task_id,
      }
    }
    if (row.task_kind === "delete") {
      return {
        artifacts: artifacts.map(dispatchArtifact),
        backupId: row.backup_id,
        kind: "delete",
        target: { id: row.target_id, kind: row.target_kind },
        taskId: row.task_id,
      }
    }
    return {
      artifacts: artifacts.map(dispatchArtifact),
      artifactKind: row.artifact_kind,
      backupId: row.backup_id,
      exclude: parseExcludes(row.exclude_patterns),
      kind: "create",
      maxBytes: nullableDatabaseNumber(
        row.reserved_bytes,
        "backup reservation"
      ),
      mode: row.backup_mode,
      reason: row.reason,
      target: { id: row.target_id, kind: row.target_kind },
      taskId: row.task_id,
    }
  })
})

export const reserveBackupRestoreEffect = Effect.fn("backups.reserveRestore")(
  function* (input: {
    backupId: string
    dependsOnTaskId: string | null
    requestedBy: string
    taskId: string
  }) {
    const database = yield* Database
    return yield* database.transaction(
      "backup_reserve_restore",
      (transaction) =>
        Effect.gen(function* () {
          const rows = yield* transaction.queryRows<BackupRow>(
            `SELECT backup.id, backup.relay_id, backup.target_kind,
                    backup.target_id, backup.storage_id, backup.object_key,
                    backup.bytes, backup.checksum_sha256
               FROM ${databaseTable("backup")} backup
              WHERE backup.id = ? AND backup.status = 'available'
                AND backup.backup_mode = 'full'
                AND ((backup.target_kind = 'instance' AND backup.artifact_kind = 'archive')
                  OR (backup.target_kind = 'database' AND backup.artifact_kind = 'database_dump'))
                AND NOT EXISTS (
                  SELECT 1
                    FROM ${databaseTable("backup_task")} active_task
                   WHERE active_task.backup_id = backup.id
                     AND active_task.task_kind IN ('restore', 'delete')
                     AND active_task.status IN ('queued', 'running')
                )
              FOR UPDATE`,
            [input.backupId]
          )
          const backup = rows[0]
          const artifacts = backup
            ? yield* transaction.queryRows<BackupArtifactRow>(
                `SELECT artifact.id, artifact.backup_id, artifact.storage_id,
                        artifact.status, artifact.filename, artifact.object_key,
                        artifact.bytes, artifact.checksum_sha256, artifact.error
                   FROM ${databaseTable("backup_artifact")} artifact
                  WHERE artifact.backup_id = ? AND artifact.status = 'available'
                  ORDER BY (artifact.storage_id IS NULL) DESC, artifact.created_at ASC
                  FOR UPDATE`,
                [input.backupId]
              )
            : []
          const artifact = artifacts[0]
          const bytes = nullableDatabaseNumber(
            artifact?.bytes ?? null,
            "backup artifact bytes"
          )
          if (
            !backup ||
            !artifact ||
            bytes === null ||
            !artifact.checksum_sha256
          ) {
            return yield* BackupStorageError.make({
              code: "backup_unavailable",
              operation: "backup.restore",
              reason: "Only complete backups can be restored",
            })
          }
          yield* transaction.queryRows<RowDataPacket>(
            `SELECT relay_id
               FROM ${databaseTable("backup_policy")}
              WHERE relay_id = ? AND target_kind = ? AND target_id = ?
              FOR UPDATE`,
            [backup.relay_id, backup.target_kind, backup.target_id]
          )
          const conflictingTasks =
            yield* transaction.queryRows<KnownBackupTaskRow>(
              `SELECT task.id
                 FROM ${databaseTable("backup_task")} task
                 JOIN ${databaseTable("backup")} active_backup
                   ON active_backup.id = task.backup_id
                WHERE active_backup.relay_id = ?
                  AND active_backup.target_kind = ?
                  AND active_backup.target_id = ?
                  AND task.task_kind = 'restore'
                  AND task.status IN ('queued', 'running')
                LIMIT 1`,
              [backup.relay_id, backup.target_kind, backup.target_id]
            )
          const finalDeletionTable =
            backup.target_kind === "database"
              ? "backup_final_database_delete"
              : "backup_final_delete"
          const finalDeletions = yield* transaction.queryRows<RowDataPacket>(
            `SELECT target_id
                 FROM ${databaseTable(finalDeletionTable)}
                WHERE relay_id = ? AND target_id = ?
                  AND status IN ('backing_up', 'deleting')
                LIMIT 1`,
            [backup.relay_id, backup.target_id]
          )
          if (conflictingTasks[0] || finalDeletions[0]) {
            return yield* BackupStorageError.make({
              code: "restore_in_progress",
              operation: "backup.restore",
              reason:
                "Another restore or final resource deletion is already in progress",
            })
          }
          if (input.dependsOnTaskId) {
            const dependencies =
              yield* transaction.queryRows<KnownBackupTaskRow>(
                `SELECT id
                 FROM ${databaseTable("backup_task")}
                WHERE id = ? AND task_kind = 'create'
                LIMIT 1`,
                [input.dependsOnTaskId]
              )
            if (!dependencies[0]) {
              return yield* BackupStorageError.make({
                code: "invalid_restore_dependency",
                operation: "backup.restore",
                reason: "The pre-restore safety backup was not reserved",
              })
            }
          }
          yield* transaction.execute(
            `INSERT INTO ${databaseTable("backup_task")}
              (id, backup_id, task_kind, status, depends_on_task_id, requested_by)
             VALUES (?, ?, 'restore', 'queued', ?, ?)`,
            [
              input.taskId,
              input.backupId,
              input.dependsOnTaskId,
              input.requestedBy,
            ]
          )
          return {
            artifactId: artifact.id,
            backupId: input.backupId,
            bytes,
            checksumSha256: artifact.checksum_sha256,
            kind: "restore",
            objectKey: artifact.object_key,
            storageId: artifact.storage_id,
            target: { id: backup.target_id, kind: backup.target_kind },
            taskId: input.taskId,
          } satisfies BackupRestoreDispatch
        })
    )
  }
)

export const reserveBackupDeleteEffect = Effect.fn("backups.reserveDelete")(
  function* (input: { backupId: string; requestedBy: string; taskId: string }) {
    const database = yield* Database
    return yield* database.transaction("backup_reserve_delete", (transaction) =>
      Effect.gen(function* () {
        const rows = yield* transaction.queryRows<BackupRow>(
          `SELECT backup.id, backup.relay_id, backup.target_kind,
                  backup.target_id, backup.storage_id, backup.object_key
             FROM ${databaseTable("backup")} backup
            WHERE backup.id = ? AND backup.status IN ('available', 'failed')
              AND NOT EXISTS (
                SELECT 1
                  FROM ${databaseTable("backup_task")} active_task
                 WHERE active_task.backup_id = backup.id
                   AND active_task.task_kind = 'restore'
                   AND active_task.status IN ('queued', 'running')
              )
            FOR UPDATE`,
          [input.backupId]
        )
        const backup = rows[0]
        if (!backup) {
          return yield* BackupStorageError.make({
            code: "backup_unavailable",
            operation: "backup.delete",
            reason: "Only complete or failed backups can be deleted",
          })
        }
        yield* transaction.execute(
          `UPDATE ${databaseTable("backup")}
              SET status = 'deleting'
            WHERE id = ?`,
          [input.backupId]
        )
        yield* transaction.execute(
          `INSERT INTO ${databaseTable("backup_task")}
            (id, backup_id, task_kind, status, requested_by)
           VALUES (?, ?, 'delete', 'queued', ?)`,
          [input.taskId, input.backupId, input.requestedBy]
        )
        return {
          artifacts: (yield* transaction.queryRows<BackupArtifactRow>(
            `SELECT artifact.id, artifact.backup_id, artifact.storage_id,
                      artifact.status, artifact.filename, artifact.object_key,
                      artifact.bytes, artifact.checksum_sha256, artifact.error
                 FROM ${databaseTable("backup_artifact")} artifact
                WHERE artifact.backup_id = ? AND artifact.status <> 'deleted'
                ORDER BY (artifact.storage_id IS NULL) DESC, artifact.created_at ASC`,
            [input.backupId]
          )).map(dispatchArtifact),
          backupId: input.backupId,
          kind: "delete",
          target: { id: backup.target_id, kind: backup.target_kind },
          taskId: input.taskId,
        } satisfies BackupDeleteDispatch
      })
    )
  }
)

export const updateBackupLimitsEffect = Effect.fn("backups.updateLimits")(
  function* (input: {
    admin: boolean
    quantityLimit: number | null
    relayId: string
    sizeLimitBytes: number | null
    targetId: string
  }) {
    const database = yield* Database
    const quantityColumn = input.admin
      ? "admin_quantity_limit"
      : "quantity_limit"
    const sizeColumn = input.admin
      ? "admin_size_limit_bytes"
      : "size_limit_bytes"
    yield* database.execute(
      "backup_limits_update",
      `INSERT INTO ${databaseTable("backup_policy")}
        (relay_id, target_kind, target_id, exclude_patterns,
         ${quantityColumn}, ${sizeColumn})
       VALUES (?, 'instance', ?, JSON_ARRAY(), ?, ?)
       ON DUPLICATE KEY UPDATE
         ${quantityColumn} = VALUES(${quantityColumn}),
         ${sizeColumn} = VALUES(${sizeColumn})`,
      [input.relayId, input.targetId, input.quantityLimit, input.sizeLimitBytes]
    )
  }
)

export const getInstanceBackupPolicyEffect = Effect.fn(
  "backups.getInstancePolicy"
)(function* (relayId: string, targetId: string) {
  const database = yield* Database
  const rows = yield* database.queryRows<BackupPolicyRow>(
    "backup_policy_get_instance",
    `SELECT exclude_patterns, quantity_limit, size_limit_bytes, storage_id,
            admin_quantity_limit, admin_size_limit_bytes
       FROM ${databaseTable("backup_policy")}
      WHERE relay_id = ? AND target_kind = 'instance' AND target_id = ?
      LIMIT 1`,
    [relayId, targetId]
  )
  const policy = rows[0]
  return {
    adminQuantityLimit: policy?.admin_quantity_limit ?? null,
    adminSizeLimitBytes: nullableDatabaseNumber(
      policy?.admin_size_limit_bytes ?? null,
      "admin backup size limit"
    ),
    exclude: parseExcludes(policy?.exclude_patterns ?? []),
    quantityLimit: policy?.quantity_limit ?? null,
    sizeLimitBytes: nullableDatabaseNumber(
      policy?.size_limit_bytes ?? null,
      "backup size limit"
    ),
    storageId: policy?.storage_id ?? null,
  } satisfies InstanceBackupPolicy
})

export const updateBackupExcludesEffect = Effect.fn("backups.updateExcludes")(
  function* (input: {
    exclude: ReadonlyArray<string>
    relayId: string
    targetId: string
  }) {
    const database = yield* Database
    yield* database.execute(
      "backup_excludes_update",
      `INSERT INTO ${databaseTable("backup_policy")}
        (relay_id, target_kind, target_id, exclude_patterns)
       VALUES (?, 'instance', ?, ?)
       ON DUPLICATE KEY UPDATE exclude_patterns = VALUES(exclude_patterns)`,
      [input.relayId, input.targetId, JSON.stringify(input.exclude)]
    )
  }
)

export const getFinalInstanceDeletionEffect = Effect.fn(
  "backups.finalDelete.get"
)(function* (relayId: string, targetId: string) {
  const database = yield* Database
  const rows = yield* database.queryRows<FinalInstanceDeletionRow>(
    "backup_final_delete_get",
    `${finalInstanceDeletionSelect}
      WHERE final_delete.relay_id = ? AND final_delete.target_id = ?
      LIMIT 1`,
    [relayId, targetId]
  )
  return rows[0] ? toFinalInstanceDeletion(rows[0]) : null
})

export const listPendingFinalInstanceDeletionsEffect = Effect.fn(
  "backups.finalDelete.listPending"
)(function* (relayId: string) {
  const database = yield* Database
  const rows = yield* database.queryRows<FinalInstanceDeletionRow>(
    "backup_final_delete_list_pending",
    `${finalInstanceDeletionSelect}
      WHERE final_delete.relay_id = ?
        AND final_delete.status IN ('backing_up', 'deleting')
      ORDER BY final_delete.created_at ASC, final_delete.target_id ASC`,
    [relayId]
  )
  return rows.map(toFinalInstanceDeletion)
})

export const clearFailedFinalInstanceDeletionEffect = Effect.fn(
  "backups.finalDelete.clearFailed"
)(function* (relayId: string, targetId: string) {
  const database = yield* Database
  const result = yield* database.execute(
    "backup_final_delete_clear_failed",
    `DELETE FROM ${databaseTable("backup_final_delete")}
      WHERE relay_id = ? AND target_id = ? AND status = 'failed'`,
    [relayId, targetId]
  )
  return result.affectedRows > 0
})

export const updateFinalInstanceDeletionEffect = Effect.fn(
  "backups.finalDelete.update"
)(function* (input: {
  error: string | null
  from: ReadonlyArray<FinalInstanceDeletion["status"]>
  relayId: string
  status: FinalInstanceDeletion["status"]
  targetId: string
}) {
  const database = yield* Database
  const placeholders = input.from.map(() => "?").join(", ")
  const result = yield* database.execute(
    "backup_final_delete_update",
    `UPDATE ${databaseTable("backup_final_delete")}
        SET status = ?, error = ?
      WHERE relay_id = ? AND target_id = ?
        AND status IN (${placeholders})`,
    [input.status, input.error, input.relayId, input.targetId, ...input.from]
  )
  return result.affectedRows > 0
})

export const getFinalDatabaseDeletionEffect = Effect.fn(
  "backups.finalDatabaseDelete.get"
)(function* (relayId: string, targetId: string) {
  const database = yield* Database
  const rows = yield* database.queryRows<FinalDatabaseDeletionRow>(
    "backup_final_database_delete_get",
    `${finalDatabaseDeletionSelect}
      WHERE final_delete.relay_id = ? AND final_delete.target_id = ?
      LIMIT 1`,
    [relayId, targetId]
  )
  return rows[0] ? toFinalInstanceDeletion(rows[0]) : null
})

export const listPendingFinalDatabaseDeletionsEffect = Effect.fn(
  "backups.finalDatabaseDelete.listPending"
)(function* (relayId: string) {
  const database = yield* Database
  const rows = yield* database.queryRows<FinalDatabaseDeletionRow>(
    "backup_final_database_delete_list_pending",
    `${finalDatabaseDeletionSelect}
      WHERE final_delete.relay_id = ?
        AND final_delete.status IN ('backing_up', 'deleting')
      ORDER BY final_delete.created_at ASC, final_delete.target_id ASC`,
    [relayId]
  )
  return rows.map(toFinalInstanceDeletion)
})

export const clearFailedFinalDatabaseDeletionEffect = Effect.fn(
  "backups.finalDatabaseDelete.clearFailed"
)(function* (relayId: string, targetId: string) {
  const database = yield* Database
  const result = yield* database.execute(
    "backup_final_database_delete_clear_failed",
    `DELETE FROM ${databaseTable("backup_final_database_delete")}
      WHERE relay_id = ? AND target_id = ? AND status = 'failed'`,
    [relayId, targetId]
  )
  return result.affectedRows > 0
})

export const updateFinalDatabaseDeletionEffect = Effect.fn(
  "backups.finalDatabaseDelete.update"
)(function* (input: {
  error: string | null
  from: ReadonlyArray<FinalDatabaseDeletion["status"]>
  relayId: string
  status: FinalDatabaseDeletion["status"]
  targetId: string
}) {
  const database = yield* Database
  const placeholders = input.from.map(() => "?").join(", ")
  const result = yield* database.execute(
    "backup_final_database_delete_update",
    `UPDATE ${databaseTable("backup_final_database_delete")}
        SET status = ?, error = ?
      WHERE relay_id = ? AND target_id = ?
        AND status IN (${placeholders})`,
    [input.status, input.error, input.relayId, input.targetId, ...input.from]
  )
  return result.affectedRows > 0
})

const finalInstanceDeletionSelect = `SELECT final_delete.relay_id,
       final_delete.target_id, final_delete.backup_id,
       final_delete.requested_by, final_delete.status, final_delete.error,
       backup.status AS backup_status,
       create_task.error AS task_error
  FROM ${databaseTable("backup_final_delete")} final_delete
  JOIN ${databaseTable("backup")} backup ON backup.id = final_delete.backup_id
  JOIN ${databaseTable("backup_task")} create_task ON create_task.id = (
    SELECT task.id
      FROM ${databaseTable("backup_task")} task
     WHERE task.backup_id = backup.id AND task.task_kind = 'create'
     ORDER BY task.created_at DESC, task.id DESC
     LIMIT 1
  )`

const finalDatabaseDeletionSelect = `SELECT final_delete.relay_id,
       final_delete.target_id, final_delete.backup_id,
       final_delete.requested_by, final_delete.status, final_delete.error,
       backup.status AS backup_status,
       create_task.error AS task_error
  FROM ${databaseTable("backup_final_database_delete")} final_delete
  JOIN ${databaseTable("backup")} backup ON backup.id = final_delete.backup_id
  JOIN ${databaseTable("backup_task")} create_task ON create_task.id = (
    SELECT task.id
      FROM ${databaseTable("backup_task")} task
     WHERE task.backup_id = backup.id AND task.task_kind = 'create'
     ORDER BY task.created_at DESC, task.id DESC
     LIMIT 1
  )`

function toFinalInstanceDeletion(
  row: FinalInstanceDeletionRow
): FinalInstanceDeletion {
  return {
    backupId: row.backup_id,
    backupStatus: row.backup_status,
    error: row.error,
    relayId: row.relay_id,
    requestedBy: row.requested_by,
    status: row.status,
    targetId: row.target_id,
    taskError: row.task_error,
  }
}

export function effectiveBackupLimit(
  userLimit: number | null,
  adminLimit: number | null
): number | null {
  if (userLimit === null) return adminLimit
  if (adminLimit === null) return userLimit
  return Math.min(userLimit, adminLimit)
}

export function backupReservation(input: {
  quantityLimit: number | null
  quantityUsed: number
  requestedMaxBytes: number | null
  sizeLimit: number | null
  sizeUsed: number
}): { maxBytes: number | null } {
  if (
    input.quantityLimit !== null &&
    input.quantityUsed >= input.quantityLimit
  ) {
    throw BackupLimitError.make({
      kind: "quantity",
      limit: input.quantityLimit,
      used: input.quantityUsed,
    })
  }
  const remaining =
    input.sizeLimit === null
      ? null
      : Math.max(0, input.sizeLimit - input.sizeUsed)
  if (remaining !== null && remaining === 0) {
    throw BackupLimitError.make({
      kind: "size",
      limit: input.sizeLimit ?? 0,
      used: input.sizeUsed,
    })
  }
  return {
    maxBytes:
      input.requestedMaxBytes === null
        ? remaining
        : remaining === null
          ? input.requestedMaxBytes
          : Math.min(input.requestedMaxBytes, remaining),
  }
}

export function shouldApplyRelayBackupTaskSnapshot(
  current: BackupTaskReconcileState,
  incoming: Pick<RelayBackupTask, "bytesCompleted" | "status" | "updatedAt">
): boolean {
  if (
    isTerminalBackupTaskStatus(current.status) &&
    !isTerminalBackupTaskStatus(incoming.status)
  ) {
    return false
  }
  if (current.relayUpdatedAt === null) return true
  if (incoming.updatedAt !== current.relayUpdatedAt) {
    return incoming.updatedAt > current.relayUpdatedAt
  }
  if (incoming.status === current.status) {
    return incoming.bytesCompleted >= current.bytesCompleted
  }
  return (
    backupTaskStatusOrder(incoming.status) >
    backupTaskStatusOrder(current.status)
  )
}

function isTerminalBackupTaskStatus(status: BackupTaskStatus): boolean {
  return status === "cancelled" || status === "failed" || status === "succeeded"
}

function backupTaskStatusOrder(status: BackupTaskStatus): number {
  switch (status) {
    case "queued":
      return 0
    case "running":
      return 1
    case "cancelled":
    case "failed":
    case "succeeded":
      return 2
  }
}

function deduplicateStorageIds(
  storageIds: ReadonlyArray<string | null>
): Array<string | null> {
  const seen = new Set<string>()
  return storageIds.filter((storageId) => {
    const key = storageId ?? "local"
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function dispatchArtifact(artifact: BackupArtifactRow): BackupDispatchArtifact {
  return {
    artifactId: artifact.id,
    objectKey: artifact.object_key,
    storageId: artifact.storage_id,
  }
}

function parseExcludes(value: unknown): Array<string> {
  const parsed = parseJsonArray(value)
  return parsed.filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.length > 0 && entry.length <= 1_024
  )
}

function parseWarnings(value: unknown): Array<string> {
  return parseJsonArray(value).filter(
    (entry): entry is string => typeof entry === "string"
  )
}

function parseJsonArray(value: unknown): Array<unknown> {
  if (Array.isArray(value)) return value
  if (typeof value !== "string") return []
  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed) ? parsed : []
}

function nullableDatabaseNumber(
  value: number | string | null,
  label: string
): number | null {
  return value === null ? null : safeDatabaseNumber(value, label)
}

function safeDatabaseNumber(value: number | string, label: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} is outside the supported integer range`)
  }
  return parsed
}

function timestampIso(
  value: number | string | null,
  label: string
): string | null {
  return value === null
    ? null
    : new Date(safeDatabaseNumber(value, label)).toISOString()
}

function requiredTimestampIso(
  value: number | string | null,
  label: string
): string {
  const timestamp = timestampIso(value, label)
  if (timestamp === null) throw new Error(`${label} is missing`)
  return timestamp
}
