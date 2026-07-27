import type { RowDataPacket } from "mysql2/promise"
import { Effect } from "effect"

import { Database } from "@/effect/database"
import type { AppearanceOverride } from "@/lib/appearance"
import { normalizeAppearanceOverride } from "@/lib/appearance"
import { databaseTable } from "@/lib/database-config"

const appearanceSettingKey = "appearance"

interface AppearanceSettingRow extends RowDataPacket {
  setting_value: unknown
}

function decodeSettingValue(value: unknown): AppearanceOverride {
  if (typeof value !== "string") return normalizeAppearanceOverride(value)
  try {
    return normalizeAppearanceOverride(JSON.parse(value))
  } catch {
    return normalizeAppearanceOverride(null)
  }
}

export const loadAppearanceOverrideEffect = Effect.fn(
  "appearancePreferences.load"
)(function* (userId: string) {
  const database = yield* Database
  const rows = yield* database.queryRows<AppearanceSettingRow>(
    "appearancePreferences.load",
    `SELECT setting_value
       FROM ${databaseTable("setting")}
      WHERE user_id = ? AND setting_key = ?
      LIMIT 1`,
    [userId, appearanceSettingKey]
  )
  return decodeSettingValue(rows[0]?.setting_value)
})

export const saveAppearanceOverrideEffect = Effect.fn(
  "appearancePreferences.save"
)(function* (id: string, userId: string, preferences: AppearanceOverride) {
  const database = yield* Database
  yield* database.execute(
    "appearancePreferences.save",
    `INSERT INTO ${databaseTable("setting")}
       (id, user_id, setting_key, setting_value)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [id, userId, appearanceSettingKey, JSON.stringify(preferences)]
  )
})
