import { readFile } from "node:fs/promises"

import mysql from "mysql2/promise"

import {
  databaseConnectionConfig,
  databaseTable,
  databaseTableName,
  prefixAppMigrationSql,
} from "./database-config.mjs"

const sql = prefixAppMigrationSql(
  await readFile(new URL("../migrations/app.sql", import.meta.url), "utf8")
)
const connection = await mysql.createConnection({
  ...databaseConnectionConfig(),
  multipleStatements: true,
  timezone: "Z",
})

try {
  await connection.query(sql)
  await ensureFileActivitySchema(connection)
  await ensureTailscaleNetworkSchema(connection)
  console.log("Kiln application tables are up to date")
} finally {
  await connection.end()
}

async function ensureTailscaleNetworkSchema(database) {
  const [columns] = await database.query(
    `SHOW COLUMNS FROM ${databaseTable("tailscale_network")}`
  )
  const names = new Set(columns.map((column) => column.Field))
  const additions = [
    [
      "oauth_client_id",
      "VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NULL",
    ],
    ["oauth_client_secret_ciphertext", "TEXT NULL"],
    ["oauth_scopes", "JSON NULL"],
    ["oauth_tags", "JSON NULL"],
    ["oauth_last_synced_at", "TIMESTAMP(3) NULL"],
    ["oauth_last_error", "VARCHAR(512) NULL"],
  ].filter(([name]) => !names.has(name))
  if (additions.length === 0) return
  await database.query(
    `ALTER TABLE ${databaseTable("tailscale_network")} ${additions
      .map(([name, definition]) => `ADD COLUMN ${name} ${definition}`)
      .join(", ")}`
  )
}

async function ensureFileActivitySchema(database) {
  const [displayNameColumns] = await database.query(
    `SHOW COLUMNS FROM ${databaseTable("instance")} LIKE 'display_name'`
  )
  if (displayNameColumns[0]?.Null === "NO") {
    await database.query(
      `ALTER TABLE ${databaseTable("instance")} MODIFY display_name VARCHAR(120) NULL`
    )
  }
  await database.query(
    `UPDATE ${databaseTable("instance")}
        SET display_name = NULL
      WHERE display_name = ''`
  )

  const activityTableName = databaseTableName("file_activity")
  const instanceConstraintName = databaseTableName("file_activity_instance_fk")
  const relayConstraintName = databaseTableName("file_activity_relay_fk")
  const [constraints] = await database.execute(
    `SELECT CONSTRAINT_NAME
       FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [activityTableName]
  )
  const constraintNames = new Set(
    constraints.map((constraint) => constraint.CONSTRAINT_NAME)
  )
  if (constraintNames.has(instanceConstraintName)) return

  await database.query(
    `INSERT IGNORE INTO ${databaseTable("instance")}
       (relay_id, instance_id, display_name)
     SELECT DISTINCT relay_id, instance_id, NULL
       FROM ${databaseTable("file_activity")}`
  )
  if (constraintNames.has(relayConstraintName)) {
    await database.query(
      `ALTER TABLE ${databaseTable("file_activity")}
       DROP FOREIGN KEY ${databaseTable("file_activity_relay_fk")}`
    )
  }
  await database.query(
    `ALTER TABLE ${databaseTable("file_activity")}
     ADD CONSTRAINT ${databaseTable("file_activity_instance_fk")}
     FOREIGN KEY (relay_id, instance_id)
     REFERENCES ${databaseTable("instance")} (relay_id, instance_id)
     ON DELETE CASCADE`
  )
}
