import type { RowDataPacket } from "mysql2/promise"
import { Effect } from "effect"

import {
  relayInstanceNameSchema,
  relayTailscaleDomainSchema,
  relayTailscaleStackIdSchema,
} from "@workspace/contracts"

import { Database } from "@/effect/database"
import { databaseTable } from "@/lib/database-config"

export interface TailscaleNetworkDefinition {
  domain: string
  id: string
  name: string
}

interface TailscaleNetworkRow extends RowDataPacket {
  domain: string
  id: string
  name: string
}

export const loadTailscaleNetworkDefinitionsEffect = Effect.fn(
  "tailscaleNetworks.load"
)(function* () {
  const database = yield* Database
  const rows = yield* database.queryRows<TailscaleNetworkRow>(
    "tailscaleNetworks.load",
    `SELECT id, name, domain
       FROM ${databaseTable("tailscale_network")}
      ORDER BY name, id`
  )
  return rows.map((row) => ({
    domain: relayTailscaleDomainSchema.parse(row.domain),
    id: relayTailscaleStackIdSchema.parse(row.id),
    name: relayInstanceNameSchema.parse(row.name),
  }))
})

export const saveTailscaleNetworkDefinitionEffect = Effect.fn(
  "tailscaleNetworks.save"
)(function* (definition: TailscaleNetworkDefinition) {
  const database = yield* Database
  yield* database.execute(
    "tailscaleNetworks.save",
    `INSERT INTO ${databaseTable("tailscale_network")} (id, name, domain)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       domain = VALUES(domain)`,
    [definition.id, definition.name, definition.domain]
  )
})

export const removeTailscaleNetworkDefinitionEffect = Effect.fn(
  "tailscaleNetworks.remove"
)(function* (id: string) {
  const database = yield* Database
  yield* database.execute(
    "tailscaleNetworks.remove",
    `DELETE FROM ${databaseTable("tailscale_network")} WHERE id = ?`,
    [id]
  )
})
