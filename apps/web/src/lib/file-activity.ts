import { createHash } from "node:crypto"

import {
  relayFileActivitySchema,
  type RelayFileActivity,
} from "@workspace/contracts"
import type { RowDataPacket } from "mysql2/promise"
import { Effect } from "effect"

import { Database } from "@/effect/database"
import { FilePinLimitError } from "@/effect/errors"
import { runAppEffect } from "@/effect/runtime"
import { databaseTable } from "@/lib/database-config"

const recentFileLimit = 12
const pinnedFileLimit = 48

interface FileActivityRow extends RowDataPacket {
  instance_id: string
  path: string
  pinned: boolean | number
  last_viewed_at_ms: number | string
  last_edited_at_ms: number | string | null
}

interface PinnedFileCountRow extends RowDataPacket {
  pinned_count: number | string
}

function pathHash(path: string): string {
  return createHash("sha256").update(path).digest("hex")
}

function activityFromRows(
  instanceId: string,
  rows: ReadonlyArray<FileActivityRow>
): RelayFileActivity {
  return relayFileActivitySchema.parse({
    instanceId,
    files: rows.map((row) => ({
      instanceId: row.instance_id,
      path: row.path,
      pinned: Boolean(row.pinned),
      lastViewedAt: new Date(Number(row.last_viewed_at_ms)).toISOString(),
      lastEditedAt:
        row.last_edited_at_ms === null
          ? null
          : new Date(Number(row.last_edited_at_ms)).toISOString(),
    })),
  })
}

export const listFileActivityEffect = Effect.fn("files.activity.list")(
  function* (relayId: string, instanceId: string) {
    const database = yield* Database
    const [pinnedRows, recentRows] = yield* Effect.all(
      [
        database.queryRows<FileActivityRow>(
          "file_activity_pinned",
          `SELECT instance_id, path, pinned,
                  CAST(UNIX_TIMESTAMP(last_viewed_at) * 1000 AS UNSIGNED) AS last_viewed_at_ms,
                  CAST(UNIX_TIMESTAMP(last_edited_at) * 1000 AS UNSIGNED) AS last_edited_at_ms
             FROM ${databaseTable("file_activity")}
            WHERE relay_id = ? AND instance_id = ? AND pinned = TRUE
            ORDER BY GREATEST(last_viewed_at, COALESCE(last_edited_at, last_viewed_at)) DESC
            LIMIT ${pinnedFileLimit}`,
          [relayId, instanceId]
        ),
        database.queryRows<FileActivityRow>(
          "file_activity_recent",
          `SELECT instance_id, path, pinned,
                  CAST(UNIX_TIMESTAMP(last_viewed_at) * 1000 AS UNSIGNED) AS last_viewed_at_ms,
                  CAST(UNIX_TIMESTAMP(last_edited_at) * 1000 AS UNSIGNED) AS last_edited_at_ms
             FROM ${databaseTable("file_activity")}
            WHERE relay_id = ? AND instance_id = ? AND pinned = FALSE
            ORDER BY GREATEST(last_viewed_at, COALESCE(last_edited_at, last_viewed_at)) DESC
            LIMIT ${recentFileLimit}`,
          [relayId, instanceId]
        ),
      ],
      { concurrency: "unbounded" }
    )
    return activityFromRows(instanceId, [...pinnedRows, ...recentRows])
  }
)

const ensureActivityInstanceEffect = Effect.fn("files.activity.ensureInstance")(
  function* (relayId: string, instanceId: string) {
    const database = yield* Database
    yield* database.execute(
      "file_activity_ensure_instance",
      `INSERT IGNORE INTO ${databaseTable("instance")}
         (relay_id, instance_id, display_name)
       VALUES (?, ?, NULL)`,
      [relayId, instanceId]
    )
  }
)

const recordFileViewedEffect = Effect.fn("files.activity.recordView")(
  function* (relayId: string, instanceId: string, path: string) {
    yield* ensureActivityInstanceEffect(relayId, instanceId)
    const database = yield* Database
    yield* database.execute(
      "file_activity_record_view",
      `INSERT INTO ${databaseTable("file_activity")}
         (relay_id, instance_id, path_hash, path, last_viewed_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
         path = VALUES(path),
         last_viewed_at = CURRENT_TIMESTAMP(3)`,
      [relayId, instanceId, pathHash(path), path]
    )
  }
)

const recordFileEditedEffect = Effect.fn("files.activity.recordEdit")(
  function* (relayId: string, instanceId: string, path: string) {
    yield* ensureActivityInstanceEffect(relayId, instanceId)
    const database = yield* Database
    yield* database.execute(
      "file_activity_record_edit",
      `INSERT INTO ${databaseTable("file_activity")}
         (relay_id, instance_id, path_hash, path, last_viewed_at, last_edited_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
         path = VALUES(path),
         last_viewed_at = CURRENT_TIMESTAMP(3),
         last_edited_at = CURRENT_TIMESTAMP(3)`,
      [relayId, instanceId, pathHash(path), path]
    )
  }
)

const setFilePinnedEffect = Effect.fn("files.activity.setPinned")(function* (
  relayId: string,
  instanceId: string,
  path: string,
  pinned: boolean
) {
  const database = yield* Database
  const hash = pathHash(path)
  yield* ensureActivityInstanceEffect(relayId, instanceId)
  const updated = yield* database.transaction(
    "file_activity_set_pinned",
    async (transaction) => {
      await transaction.queryRows(
        `SELECT instance_id
           FROM ${databaseTable("instance")}
          WHERE relay_id = ? AND instance_id = ?
          FOR UPDATE`,
        [relayId, instanceId]
      )
      if (pinned) {
        const [count] = await transaction.queryRows<PinnedFileCountRow>(
          `SELECT COUNT(*) AS pinned_count
             FROM ${databaseTable("file_activity")}
            WHERE relay_id = ?
              AND instance_id = ?
              AND pinned = TRUE
              AND path_hash <> ?`,
          [relayId, instanceId, hash]
        )
        if (Number(count?.pinned_count ?? 0) >= pinnedFileLimit) return false
      }
      await transaction.execute(
        `INSERT INTO ${databaseTable("file_activity")}
           (relay_id, instance_id, path_hash, path, pinned, last_viewed_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
           path = VALUES(path),
           pinned = VALUES(pinned)`,
        [relayId, instanceId, hash, path, pinned]
      )
      return true
    }
  )
  if (!updated) return yield* FilePinLimitError.make({ limit: pinnedFileLimit })
})

export function listFileActivity(
  relayId: string,
  instanceId: string
): Promise<RelayFileActivity> {
  return runAppEffect(
    "files.activity.list",
    listFileActivityEffect(relayId, instanceId)
  )
}

export function recordFileViewed(
  relayId: string,
  instanceId: string,
  path: string
): Promise<void> {
  return runAppEffect(
    "files.activity.recordView",
    recordFileViewedEffect(relayId, instanceId, path)
  )
}

export function recordFileEdited(
  relayId: string,
  instanceId: string,
  path: string
): Promise<void> {
  return runAppEffect(
    "files.activity.recordEdit",
    recordFileEditedEffect(relayId, instanceId, path)
  )
}

export async function setFilePinned(
  relayId: string,
  instanceId: string,
  path: string,
  pinned: boolean
): Promise<RelayFileActivity> {
  await runAppEffect(
    "files.activity.setPinned",
    setFilePinnedEffect(relayId, instanceId, path, pinned)
  )
  return listFileActivity(relayId, instanceId)
}
