import type { RowDataPacket } from "mysql2/promise"
import { Effect } from "effect"

import { Database } from "@/effect/database"
import type {
  AppearanceOverride,
  AppearancePreferences,
} from "@/lib/appearance"
import {
  normalizeAppearanceOverride,
  normalizeAppearancePreferences,
} from "@/lib/appearance"
import { databaseTable } from "@/lib/database-config"

const appearanceSettingKey = "appearance"
const platformAppearanceDefaultId = "00000000-0000-4000-8000-000000000001"
const platformAppearanceDefaultSettingKey = "appearance.default"

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

function decodePlatformDefault(value: unknown): AppearancePreferences | null {
  if (typeof value !== "string") {
    return value === null ? null : normalizeAppearancePreferences(value)
  }
  try {
    return normalizeAppearancePreferences(JSON.parse(value))
  } catch {
    return null
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
  return rows[0] ? decodeSettingValue(rows[0].setting_value) : null
})

export const loadPlatformAppearanceDefaultEffect = Effect.fn(
  "appearancePreferences.loadPlatformDefault"
)(function* () {
  const database = yield* Database
  const rows = yield* database.queryRows<AppearanceSettingRow>(
    "appearancePreferences.loadPlatformDefault",
    `SELECT setting_value
       FROM ${databaseTable("setting")}
      WHERE id = ? AND user_id IS NULL AND setting_key = ?
      LIMIT 1`,
    [platformAppearanceDefaultId, platformAppearanceDefaultSettingKey]
  )
  return rows[0] ? decodePlatformDefault(rows[0].setting_value) : null
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

export const savePlatformAppearanceDefaultEffect = Effect.fn(
  "appearancePreferences.savePlatformDefault"
)(function* (preferences: AppearancePreferences | null) {
  const database = yield* Database
  if (!preferences) {
    yield* database.execute(
      "appearancePreferences.deletePlatformDefault",
      `DELETE FROM ${databaseTable("setting")} WHERE id = ?`,
      [platformAppearanceDefaultId]
    )
    return
  }
  yield* database.execute(
    "appearancePreferences.savePlatformDefault",
    `INSERT INTO ${databaseTable("setting")}
       (id, user_id, setting_key, setting_value)
     VALUES (?, NULL, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [
      platformAppearanceDefaultId,
      platformAppearanceDefaultSettingKey,
      JSON.stringify(preferences),
    ]
  )
})
