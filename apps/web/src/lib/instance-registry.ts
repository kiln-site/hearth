import type { RelayInstance } from "@workspace/contracts"
import { Effect } from "effect"

import { Database } from "@/effect/database"
import { runAppEffect } from "@/effect/runtime"
import { databaseTable } from "@/lib/database-config"

export function syncInstanceRegistry(
  relayId: string,
  instances: ReadonlyArray<Pick<RelayInstance, "id" | "name">>
): Promise<void> {
  return runAppEffect(
    "instances.registry.sync",
    syncInstanceRegistryEffect(relayId, instances)
  )
}

export const syncInstanceRegistryEffect = Effect.fn("instances.registry.sync")(
  function* (
    relayId: string,
    instances: ReadonlyArray<Pick<RelayInstance, "id" | "name">>
  ) {
    const database = yield* Database
    yield* database.transaction("instances.registry.sync", (transaction) =>
      Effect.gen(function* () {
        if (instances.length) {
          const values = instances.map(() => "(?, ?, NULL)").join(", ")
          yield* transaction.execute(
            `INSERT INTO ${databaseTable("instance")} (relay_id, instance_id, display_name)
         VALUES ${values}
         ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3)`,
            instances.flatMap((instance) => [relayId, instance.id])
          )
          const placeholders = instances.map(() => "?").join(", ")
          yield* transaction.execute(
            `DELETE FROM ${databaseTable("instance")}
          WHERE relay_id = ? AND instance_id NOT IN (${placeholders})`,
            [relayId, ...instances.map((instance) => instance.id)]
          )
          return
        }
        yield* transaction.execute(
          `DELETE FROM ${databaseTable("instance")} WHERE relay_id = ?`,
          [relayId]
        )
      })
    )
  }
)
