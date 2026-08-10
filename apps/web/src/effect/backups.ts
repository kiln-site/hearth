import type { RowDataPacket } from "mysql2/promise"
import { Effect } from "effect"

import type {
  BackupCreateTaskInput,
  BackupDeleteTaskInput,
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
  artifact_kind: "archive"
  backup_id: string
  backup_mode: "full"
  exclude_patterns: unknown
  object_key: string | null
  reason: BackupCreateTaskInput["reason"]
  reserved_bytes: number | string | null
  storage_id: string | null
  target_id: string
  target_kind: "instance"
  task_id: string
  task_kind: "create" | "delete"
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

export interface BackupCatalogRecord {
  artifactKind: BackupRow["artifact_kind"]
  backupMode: BackupRow["backup_mode"]
  bytes: number | null
  checksumSha256: string | null
  completedAt: string | null
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

export interface BackupCreateDispatch extends Omit<
  BackupCreateTaskInput,
  "destination"
> {
  kind: "create"
  objectKey: string | null
  storageId: string | null
}

export interface BackupDeleteDispatch extends Omit<
  BackupDeleteTaskInput,
  "destination"
> {
  kind: "delete"
  objectKey: string | null
  storageId: string | null
}

export type BackupDispatch = BackupCreateDispatch | BackupDeleteDispatch

export const reserveInstanceBackupEffect = Effect.fn("backups.reserve")(
  function* (input: {
    backupId: string
    createdBy: string
    name: string
    relayId: string
    requestedMaxBytes: number | null
    storageId?: string | null
    targetId: string
    taskId: string
  }) {
    const database = yield* Database
    return yield* database.transaction("backup_reserve", (transaction) =>
      Effect.gen(function* () {
        yield* transaction.execute(
          `INSERT IGNORE INTO ${databaseTable("backup_policy")}
            (relay_id, target_kind, target_id, exclude_patterns)
           VALUES (?, 'instance', ?, JSON_ARRAY())`,
          [input.relayId, input.targetId]
        )
        const policies = yield* transaction.queryRows<BackupPolicyRow>(
          `SELECT exclude_patterns, quantity_limit, size_limit_bytes, storage_id,
                  admin_quantity_limit, admin_size_limit_bytes
             FROM ${databaseTable("backup_policy")}
            WHERE relay_id = ? AND target_kind = 'instance' AND target_id = ?
            FOR UPDATE`,
          [input.relayId, input.targetId]
        )
        const policy = policies[0]
        if (!policy) return yield* Effect.die("Backup policy was not created")
        const storageId =
          input.storageId === undefined ? policy.storage_id : input.storageId
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
            reason: "The selected backup destination is unavailable",
          })
        }
        const objectKey = storage
          ? backupObjectKey({
              backupId: input.backupId,
              installationId: kilnInstallationId(),
              objectPrefix: storage.object_prefix,
              relayId: input.relayId,
              targetId: input.targetId,
              targetKind: "instance",
            })
          : null
        const usageRows = yield* transaction.queryRows<BackupUsageRow>(
          `SELECT COUNT(*) AS quantity_used,
                  COALESCE(SUM(
                    CASE
                      WHEN backup.status = 'available' THEN COALESCE(backup.bytes, 0)
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
              AND backup.target_kind = 'instance'
              AND backup.target_id = ?
              AND backup.status IN ('queued', 'running', 'available')`,
          [input.relayId, input.targetId]
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
        const quantityLimit = effectiveBackupLimit(
          policy.quantity_limit,
          policy.admin_quantity_limit
        )
        const sizeLimit = effectiveBackupLimit(
          nullableDatabaseNumber(policy.size_limit_bytes, "backup size limit"),
          nullableDatabaseNumber(
            policy.admin_size_limit_bytes,
            "admin backup size limit"
          )
        )
        const reservation = backupReservation({
          quantityLimit,
          quantityUsed,
          requestedMaxBytes: input.requestedMaxBytes,
          sizeLimit,
          sizeUsed,
        })

        yield* transaction.execute(
          `INSERT INTO ${databaseTable("backup")}
            (id, relay_id, target_kind, target_id, storage_id, artifact_kind,
             backup_mode, reason, status, name, object_key, warnings, created_by)
           VALUES (?, ?, 'instance', ?, ?, 'archive', 'full', 'manual',
                   'queued', ?, ?, JSON_ARRAY(), ?)`,
          [
            input.backupId,
            input.relayId,
            input.targetId,
            storageId,
            input.name,
            objectKey,
            input.createdBy,
          ]
        )
        yield* transaction.execute(
          `INSERT INTO ${databaseTable("backup_task")}
            (id, backup_id, task_kind, status, reserved_bytes, requested_by)
           VALUES (?, ?, 'create', 'queued', ?, ?)`,
          [input.taskId, input.backupId, reservation.maxBytes, input.createdBy]
        )
        return {
          artifactKind: "archive",
          backupId: input.backupId,
          exclude: parseExcludes(policy.exclude_patterns),
          kind: "create",
          maxBytes: reservation.maxBytes,
          mode: "full",
          reason: "manual",
          objectKey,
          storageId,
          target: { id: input.targetId, kind: "instance" },
          taskId: input.taskId,
        } satisfies BackupCreateDispatch
      })
    )
  }
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
          } else if (task.status === "succeeded") {
            yield* transaction.execute(
              `UPDATE ${databaseTable("backup")}
                  SET status = 'deleted', deleted_at = FROM_UNIXTIME(? / 1000)
                WHERE id = ?`,
              [task.finishedAt ?? Date.now(), task.backupId]
            )
          } else if (task.status === "failed" || task.status === "cancelled") {
            yield* transaction.execute(
              `UPDATE ${databaseTable("backup")}
                  SET status = 'available'
                WHERE id = ?`,
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
          return
        }
        if (
          task.status === "succeeded" &&
          task.result &&
          "bytes" in task.result
        ) {
          yield* transaction.execute(
            `UPDATE ${databaseTable("backup")}
                SET status = 'available', filename = ?, bytes = ?,
                    checksum_sha256 = ?, warnings = ?,
                    completed_at = FROM_UNIXTIME(? / 1000)
              WHERE id = ?`,
            [
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
            backup.checksum_sha256, backup.warnings, backup.storage_id,
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
  return rows.map((row) => ({
    artifactKind: row.artifact_kind,
    backupMode: row.backup_mode,
    bytes: nullableDatabaseNumber(row.bytes, "backup bytes"),
    checksumSha256: row.checksum_sha256,
    completedAt: timestampIso(row.completed_at_ms, "backup completed at"),
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
  const rows = yield* database.queryRows<DispatchableBackupRow>(
    "backup_dispatchable_list",
    `SELECT backup.id AS backup_id, backup.target_kind, backup.target_id,
            backup.artifact_kind, backup.backup_mode, backup.reason,
            task.id AS task_id, task.task_kind, task.reserved_bytes,
            backup.storage_id, backup.object_key,
            COALESCE(policy.exclude_patterns, JSON_ARRAY()) AS exclude_patterns
       FROM ${databaseTable("backup")} backup
       JOIN ${databaseTable("backup_task")} task
         ON task.backup_id = backup.id
        AND task.task_kind IN ('create', 'delete')
       LEFT JOIN ${databaseTable("backup_policy")} policy
         ON policy.relay_id = backup.relay_id
        AND policy.target_kind = backup.target_kind
        AND policy.target_id = backup.target_id
      WHERE backup.relay_id = ?
        AND backup.target_kind = 'instance'
        AND backup.artifact_kind = 'archive'
        AND backup.backup_mode = 'full'
        AND ((task.task_kind = 'create' AND backup.status = 'queued')
          OR (task.task_kind = 'delete' AND backup.status = 'deleting'))
        AND task.status = 'queued'
      ORDER BY task.created_at ASC, task.id ASC`,
    [relayId]
  )
  return rows.map((row): BackupDispatch => {
    if (row.task_kind === "delete") {
      return {
        backupId: row.backup_id,
        kind: "delete",
        objectKey: row.object_key,
        storageId: row.storage_id,
        target: { id: row.target_id, kind: row.target_kind },
        taskId: row.task_id,
      }
    }
    return {
      artifactKind: row.artifact_kind,
      backupId: row.backup_id,
      exclude: parseExcludes(row.exclude_patterns),
      kind: "create",
      maxBytes: nullableDatabaseNumber(
        row.reserved_bytes,
        "backup reservation"
      ),
      mode: row.backup_mode,
      objectKey: row.object_key,
      reason: row.reason,
      storageId: row.storage_id,
      target: { id: row.target_id, kind: row.target_kind },
      taskId: row.task_id,
    }
  })
})

export const reserveBackupDeleteEffect = Effect.fn("backups.reserveDelete")(
  function* (input: { backupId: string; requestedBy: string; taskId: string }) {
    const database = yield* Database
    return yield* database.transaction("backup_reserve_delete", (transaction) =>
      Effect.gen(function* () {
        const rows = yield* transaction.queryRows<BackupRow>(
          `SELECT backup.id, backup.relay_id, backup.target_kind,
                  backup.target_id, backup.storage_id, backup.object_key
             FROM ${databaseTable("backup")} backup
            WHERE backup.id = ? AND backup.status = 'available'
            FOR UPDATE`,
          [input.backupId]
        )
        const backup = rows[0]
        if (!backup) {
          return yield* BackupStorageError.make({
            code: "backup_unavailable",
            operation: "backup.delete",
            reason: "Only available backups can be deleted",
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
          backupId: input.backupId,
          kind: "delete",
          objectKey: backup.object_key,
          storageId: backup.storage_id,
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
