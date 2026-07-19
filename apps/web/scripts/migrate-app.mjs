import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"

import mysql from "mysql2/promise"

import { encryptWithKeyring, parseSecretKeyring } from "../keyring.mjs"

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
  const [columns] = await connection.query(
    `SHOW COLUMNS FROM ${databaseTable("relay")} LIKE 'is_primary'`
  )
  if (columns.length === 0) {
    await connection.query(
      `ALTER TABLE ${databaseTable("relay")} ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT FALSE AFTER enabled`
    )
  }

  const [relayRows] = await connection.query(
    `SELECT COUNT(*) AS relay_count FROM ${databaseTable("relay")}`
  )
  if (Number(relayRows[0].relay_count) === 0) {
    const relay = configuredInitialRelay()
    if (relay) {
      await connection.execute(
        `INSERT INTO ${databaseTable("relay")}
        (id, name, hostname, port, use_tls, token_ciphertext, enabled, is_primary)
       VALUES (?, ?, ?, ?, ?, ?, TRUE, TRUE)`,
        [
          randomUUID(),
          relay.name,
          relay.url.hostname,
          Number(
            relay.url.port || (relay.url.protocol === "https:" ? 443 : 80)
          ),
          relay.url.protocol === "https:",
          encryptRelayToken(relay.token),
        ]
      )
      console.log(`Configured initial Relay ${relay.name} from KILN_RELAY_URL`)
    }
  }
  console.log("Kiln application tables are up to date")
} finally {
  await connection.end()
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

function configuredInitialRelay() {
  const configuredUrl = process.env.KILN_RELAY_URL?.trim()
  if (!configuredUrl) return null

  let url
  try {
    url = new URL(configuredUrl)
  } catch {
    throw new Error("KILN_RELAY_URL must be an absolute http or https URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("KILN_RELAY_URL must use http or https")
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "KILN_RELAY_URL must be an origin without credentials, a path, query, or fragment"
    )
  }

  const token = process.env.KILN_RELAY_KEY?.trim()
  if (!token || token.length < 32) {
    throw new Error(
      "KILN_RELAY_KEY must contain at least 32 characters when KILN_RELAY_URL is set"
    )
  }
  parseSecretKeyring(process.env.BETTER_AUTH_SECRETS)

  const name = process.env.KILN_RELAY_NAME?.trim() || "Primary Relay"
  if (name.length > 120) {
    throw new Error("KILN_RELAY_NAME must contain at most 120 characters")
  }
  return { name, token, url }
}

function encryptRelayToken(token) {
  return encryptWithKeyring(
    token,
    parseSecretKeyring(process.env.BETTER_AUTH_SECRETS),
    "kiln-relay-credential"
  )
}
