import type { RelayInstance } from "@workspace/contracts"
import type { RowDataPacket } from "mysql2/promise"

import { databasePool } from "@/lib/database"

interface InstanceNameRow extends RowDataPacket {
  display_name: string
  instance_id: string
}

export async function applyInstanceDisplayNames(
  relayId: string,
  instances: Array<RelayInstance>
): Promise<Array<RelayInstance>> {
  if (!instances.length) return instances

  const placeholders = instances.map(() => "?").join(", ")
  const [rows] = await databasePool.query<Array<InstanceNameRow>>(
    `SELECT instance_id, display_name
       FROM kiln_instance
      WHERE relay_id = ?
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
}

export async function saveInstanceDisplayName(
  relayId: string,
  instanceId: string,
  displayName: string
): Promise<void> {
  try {
    await databasePool.execute(
      `INSERT INTO kiln_instance (relay_id, instance_id, display_name)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         updated_at = CURRENT_TIMESTAMP(3)`,
      [relayId, instanceId, displayName]
    )
  } catch (cause) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "ER_DUP_ENTRY"
    ) {
      throw new Error("An instance with this name already exists on the Relay")
    }
    throw cause
  }
}
