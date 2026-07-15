import { readFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"

import mysql from "mysql2/promise"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL is required")

const sql = await readFile(new URL("../migrations/app.sql", import.meta.url), "utf8")
const connection = await mysql.createConnection({
  uri: databaseUrl,
  multipleStatements: true,
  timezone: "Z",
})

try {
  await connection.query(sql)
  const [columns] = await connection.query(
    "SHOW COLUMNS FROM kiln_relay LIKE 'is_primary'"
  )
  if (columns.length === 0) {
    await connection.query(
      "ALTER TABLE kiln_relay ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT FALSE AFTER enabled"
    )
  }

  const [relayRows] = await connection.query(
    "SELECT COUNT(*) AS relay_count FROM kiln_relay"
  )
  if (Number(relayRows[0].relay_count) === 0) {
    const relayUrl = new URL(
      process.env.RELAY_URL ?? "http://127.0.0.1:4100"
    )
    await connection.execute(
      `INSERT INTO kiln_relay
        (id, name, hostname, port, use_tls, enabled, is_primary)
       VALUES (?, ?, ?, ?, ?, TRUE, TRUE)`,
      [
        randomUUID(),
        "Local relay",
        relayUrl.hostname,
        Number(relayUrl.port || (relayUrl.protocol === "https:" ? 443 : 80)),
        relayUrl.protocol === "https:",
      ]
    )
  }
  console.log("Kiln application tables are up to date")
} finally {
  await connection.end()
}
