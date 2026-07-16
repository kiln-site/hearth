export interface DatabaseConnectionConfig {
  database: string
  host: string
  password: string
  port: number
  user: string
}

export function databaseConnectionConfig(): DatabaseConnectionConfig {
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

export function databaseTablePrefix(): string {
  const configured = process.env.DB_TABLE_PREFIX?.trim()
  return validateTablePrefix(configured || "kiln_")
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
