import type { RelayInstance } from "@workspace/contracts"
import type { RowDataPacket } from "mysql2/promise"
import { Effect } from "effect"

import { databasePool } from "@/lib/database"
import { databaseTable } from "@/lib/database-config"
import { Database } from "@/effect/database"
import { runAppEffect } from "@/effect/runtime"

interface InstanceNameRow extends RowDataPacket {
  display_name: string
  instance_id: string
}

export interface PersistedInstanceDisplayName {
  displayName: string
  instanceId: string
}

export async function applyInstanceDisplayNames(
  relayId: string,
  instances: Array<RelayInstance>
): Promise<Array<RelayInstance>> {
  return runAppEffect(
    "instances.applyDisplayNames",
    applyInstanceDisplayNamesEffect(relayId, instances)
  )
}

export const applyInstanceDisplayNamesEffect = Effect.fn(
  "instances.applyDisplayNames"
)(function* (relayId: string, instances: Array<RelayInstance>) {
  if (!instances.length) return instances

  const placeholders = instances.map(() => "?").join(", ")
  const database = yield* Database
  const rows = yield* database.queryRows<InstanceNameRow>(
    "instance_display_names",
    `SELECT instance_id, display_name
      FROM ${databaseTable("instance")}
      WHERE relay_id = ?
        AND display_name IS NOT NULL
        AND display_name <> ''
        AND instance_id IN (${placeholders})`,
    [relayId, ...instances.map((instance) => instance.id)]
  )
  const names = new Map(
    rows.map((row) => [row.instance_id, row.display_name] as const)
  )

  return instances.map((instance) => ({
    ...instance,
    name: names.get(instance.id) ?? instance.name,
  }))
})

export async function listInstanceDisplayNames(
  relayId: string
): Promise<Array<PersistedInstanceDisplayName>> {
  const [rows] = await databasePool.query<Array<InstanceNameRow>>(
    `SELECT instance_id, display_name
       FROM ${databaseTable("instance")}
      WHERE relay_id = ?
        AND display_name IS NOT NULL
        AND display_name <> ''
      ORDER BY instance_id ASC`,
    [relayId]
  )
  return rows.map((row) => ({
    displayName: row.display_name,
    instanceId: row.instance_id,
  }))
}

export async function clearInstanceDisplayName(
  relayId: string,
  instanceId: string
): Promise<void> {
  await databasePool.execute(
    `UPDATE ${databaseTable("instance")}
        SET display_name = NULL, updated_at = CURRENT_TIMESTAMP(3)
      WHERE relay_id = ? AND instance_id = ?`,
    [relayId, instanceId]
  )
}

export async function syncInstanceRegistry(
  relayId: string,
  instances: ReadonlyArray<Pick<RelayInstance, "id" | "name">>
): Promise<void> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    if (instances.length) {
      const values = instances.map(() => "(?, ?, NULL)").join(", ")
      await connection.execute(
        `INSERT INTO ${databaseTable("instance")} (relay_id, instance_id, display_name)
         VALUES ${values}
         ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3)`,
        instances.flatMap((instance) => [relayId, instance.id])
      )
      const placeholders = instances.map(() => "?").join(", ")
      await connection.execute(
        `DELETE FROM ${databaseTable("instance")}
          WHERE relay_id = ? AND instance_id NOT IN (${placeholders})`,
        [relayId, ...instances.map((instance) => instance.id)]
      )
    } else {
      await connection.execute(
        `DELETE FROM ${databaseTable("instance")} WHERE relay_id = ?`,
        [relayId]
      )
    }
    await connection.commit()
  } catch (cause) {
    await connection.rollback()
    throw cause
  } finally {
    connection.release()
  }
}
