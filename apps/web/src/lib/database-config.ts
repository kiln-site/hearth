import { createHash } from "node:crypto"

export interface DatabaseConnectionConfig {
  database: string
  host: string
  password: string
  port: number
  user: string
}

export function databaseConnectionConfig(): DatabaseConnectionConfig {
  const splitConfigured = [
    "DB_HOST",
    "DB_NAME",
    "DB_USERNAME",
    "DB_PASSWORD",
  ].some((name) => process.env[name] !== undefined)
  if (splitConfigured) {
    const host = process.env.DB_HOST?.trim()
    const database = process.env.DB_NAME?.trim()
    const user = process.env.DB_USERNAME?.trim()
    const password = process.env.DB_PASSWORD
    if (!host || !database || !user || !password) {
      throw new Error(
        "DB_HOST, DB_NAME, DB_USERNAME, and DB_PASSWORD are required when split database settings are used"
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

  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    throw new Error(
      "DB_HOST, DB_NAME, and DB_USERNAME are required (DATABASE_URL remains supported as a fallback)"
    )
  }
  const url = new URL(databaseUrl)
  if (url.protocol !== "mysql:") {
    throw new Error("DATABASE_URL must use the mysql protocol")
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ""))
  if (!url.hostname || !url.username || !database) {
    throw new Error(
      "DATABASE_URL must include a hostname, username, and database"
    )
  }
  return {
    database,
    host: url.hostname,
    password: decodeURIComponent(url.password),
    port: databasePort(url.port),
    user: decodeURIComponent(url.username),
  }
}

export function databaseTablePrefix(): string {
  const configured = process.env.DB_TABLE_PREFIX?.trim()
  if (configured) return validateTablePrefix(configured)

  const secret = process.env.BETTER_AUTH_SECRET?.trim()
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is required to generate a stable DB_TABLE_PREFIX"
    )
  }
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  const digest = createHash("sha256")
    .update(`kiln-table-prefix:${secret}`)
    .digest()
  let suffix = ""
  for (let index = 0; index < 4; index += 1) {
    suffix += alphabet[digest[index] % alphabet.length]
  }
  return `kiln${suffix}_`
}

export function databaseTableName(baseName: string): string {
  return `${databaseTablePrefix()}${databaseIdentifier("table name", baseName)}`
}

export function databaseTable(baseName: string): string {
  return `\`${databaseTableName(baseName)}\``
}

function validateTablePrefix(prefix: string): string {
  if (!/^[a-z][a-z0-9_]{0,30}_$/u.test(prefix)) {
    throw new Error(
      "DB_TABLE_PREFIX must be 2–32 lowercase letters, numbers, or underscores, start with a letter, and end with an underscore"
    )
  }
  return prefix
}

function databaseIdentifier(label: string, value: string): string {
  if (!/^[A-Za-z0-9_$]+$/u.test(value)) {
    throw new Error(`${label} contains unsupported characters`)
  }
  return value
}

function databasePort(value: string | undefined): number {
  const port = Number(value?.trim() || 3306)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("DB_PORT must be a valid TCP port")
  }
  return port
}
