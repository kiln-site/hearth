export function databaseConnectionConfig() {
  const host = process.env.DB_HOST?.trim()
  const database = process.env.DB_NAME?.trim()
  const user = process.env.DB_USERNAME?.trim()
  const password = process.env.DB_PASSWORD
  if (!host || !database || !user || !password) {
    throw new Error(
      "DB_HOST, DB_NAME, DB_USERNAME, and DB_PASSWORD are required"
    )
  }
  return {
    database,
    host,
    password,
    port: databasePort(process.env.DB_PORT),
    user,
  }
}

export function databaseTablePrefix() {
  const configured = process.env.DB_TABLE_PREFIX?.trim()
  return validateTablePrefix(configured || "kiln_")
}

export function databaseTableName(baseName) {
  return `${databaseTablePrefix()}${databaseIdentifier("table name", baseName)}`
}

export function databaseTable(baseName) {
  return `\`${databaseTableName(baseName)}\``
}

export function prefixAppMigrationSql(sql) {
  return sql.replaceAll("kiln_", databaseTablePrefix())
}

export function prefixAuthMigrationSql(sql) {
  const tableNames = [
    "user",
    "session",
    "account",
    "verification",
    "twoFactor",
    "passkey",
    "rateLimit",
  ]
  return sql.replace(
    new RegExp("`(" + tableNames.join("|") + ")`", "gu"),
    (_match, tableName) => databaseTable(tableName)
  )
}

function validateTablePrefix(prefix) {
  if (!/^[a-z][a-z0-9_]{0,30}_$/u.test(prefix)) {
    throw new Error(
      "DB_TABLE_PREFIX must be 2–32 lowercase letters, numbers, or underscores, start with a letter, and end with an underscore"
    )
  }
  return prefix
}

function databaseIdentifier(label, value) {
  if (!/^[A-Za-z0-9_$]+$/u.test(value)) {
    throw new Error(`${label} contains unsupported characters`)
  }
  return value
}

function databasePort(value) {
  const port = Number(value?.trim() || 3306)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("DB_PORT must be a valid TCP port")
  }
  return port
}
