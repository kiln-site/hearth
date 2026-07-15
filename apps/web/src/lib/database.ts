import { createPool } from "mysql2/promise"

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error("DATABASE_URL is required")

const database = new URL(databaseUrl)

export const databasePool = createPool({
  host: database.hostname,
  port: Number(database.port || 3306),
  user: decodeURIComponent(database.username),
  password: decodeURIComponent(database.password),
  database: database.pathname.replace(/^\//u, ""),
  timezone: "Z",
  connectionLimit: 10,
})
