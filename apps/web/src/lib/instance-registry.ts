import type { RelayInstance } from "@workspace/contracts"

import { databasePool } from "@/lib/database"
import { databaseTable } from "@/lib/database-config"

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
