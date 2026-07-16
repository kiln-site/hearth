import {
  createCipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto"
import { readFile } from "node:fs/promises"

import mysql from "mysql2/promise"

import {
  databaseConnectionConfig,
  databaseTable,
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
  const secret = process.env.BETTER_AUTH_SECRET?.trim()
  if (!secret || secret.length < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET must contain at least 32 characters when KILN_RELAY_URL is set"
    )
  }

  const name = process.env.KILN_RELAY_NAME?.trim() || "Primary Relay"
  if (name.length > 120) {
    throw new Error("KILN_RELAY_NAME must contain at most 120 characters")
  }
  return { name, token, url }
}

function encryptRelayToken(token) {
  const secret = process.env.BETTER_AUTH_SECRET.trim()
  const key = createHash("sha256").update(secret).digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ])
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".")
}
