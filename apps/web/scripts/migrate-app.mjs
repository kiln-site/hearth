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
  await ensureInstanceOwnershipSchema(connection)
  await ensureTailscaleNetworkSchema(connection)
  await ensureDatabaseAccessSchema(connection)
  await ensureBackupSchema(connection)
  console.log("Kiln application tables are up to date")
} finally {
  await connection.end()
}

async function ensureBackupSchema(database) {
  const [taskColumns] = await database.query(
    `SHOW COLUMNS FROM ${databaseTable("backup_task")}`
  )
  const taskColumnNames = new Set(taskColumns.map((column) => column.Field))
  if (!taskColumnNames.has("reserved_bytes")) {
    await database.query(
      `ALTER TABLE ${databaseTable("backup_task")}
       ADD COLUMN reserved_bytes BIGINT UNSIGNED NULL AFTER bytes_total`
    )
  }
  if (!taskColumnNames.has("relay_updated_at_ms")) {
    await database.query(
      `ALTER TABLE ${databaseTable("backup_task")}
       ADD COLUMN relay_updated_at_ms BIGINT UNSIGNED NULL AFTER reserved_bytes`
    )
  }
  const [privateNetworkColumns] = await database.query(
    `SHOW COLUMNS FROM ${databaseTable("backup_storage")} LIKE 'allow_private_network'`
  )
  if (privateNetworkColumns.length === 0) {
    await database.query(
      `ALTER TABLE ${databaseTable("backup_storage")}
       ADD COLUMN allow_private_network BOOLEAN NOT NULL DEFAULT FALSE AFTER force_path_style`
    )
  }
}

async function ensureInstanceOwnershipSchema(database) {
  const [ownerIdColumns] = await database.query(
    `SHOW COLUMNS FROM ${databaseTable("instance")} LIKE 'owner_id'`
  )
  if (ownerIdColumns.length === 0) {
    await database.query(
      `ALTER TABLE ${databaseTable("instance")}
       ADD COLUMN owner_id VARCHAR(36) NULL AFTER display_name`
    )
  }
}

async function ensureDatabaseAccessSchema(database) {
  const [resourceTypeColumns] = await database.query(
    `SHOW COLUMNS FROM ${databaseTable("access_grant")} LIKE 'resource_type'`
  )
  if (!resourceTypeColumns[0]?.Type?.includes("'database'")) {
    await database.query(
      `ALTER TABLE ${databaseTable("access_grant")}
       MODIFY resource_type ENUM('relay', 'instance', 'database') NOT NULL`
    )
  }
  const [databaseIdColumns] = await database.query(
    `SHOW COLUMNS FROM ${databaseTable("invitation")} LIKE 'database_id'`
  )
  if (databaseIdColumns.length === 0) {
    await database.query(
      `ALTER TABLE ${databaseTable("invitation")}
       ADD COLUMN database_id CHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER instance_id`
    )
  }
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
  if (additions.length > 0) {
    await database.query(
      `ALTER TABLE ${databaseTable("tailscale_network")} ${additions
        .map(([name, definition]) => `ADD COLUMN ${name} ${definition}`)
        .join(", ")}`
    )
  }
  await ensureTailscaleNetworkDomainUnique(database)
}

async function ensureTailscaleNetworkDomainUnique(database) {
  const tableName = databaseTableName("tailscale_network")
  const [indexes] = await database.execute(
    `SELECT INDEX_NAME
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = 'domain'
        AND NON_UNIQUE = 0`,
    [tableName]
  )
  if (indexes.length > 0) return

  const [duplicates] = await database.query(
    `SELECT domain, COUNT(*) AS network_count
       FROM ${databaseTable("tailscale_network")}
      GROUP BY domain
     HAVING COUNT(*) > 1
      LIMIT 1`
  )
  const duplicate = duplicates[0]
  if (duplicate) {
    throw new Error(
      `Cannot make Tailscale network domains unique while ${duplicate.domain} is used by ${duplicate.network_count} networks`
    )
  }

  const constraintName = databaseTableName("tailscale_network_domain_unique")
  await database.query(
    `ALTER TABLE ${databaseTable("tailscale_network")}
     ADD UNIQUE KEY \`${constraintName}\` (domain)`
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
