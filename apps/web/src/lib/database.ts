import { createPool } from "mysql2/promise"
import type { Pool } from "mysql2/promise"

import { databaseConnectionConfig } from "@/lib/database-config"

const database = databaseConnectionConfig()

const globalDatabase = globalThis as typeof globalThis & {
  kilnDatabasePool?: Pool
}

export const databasePool =
  globalDatabase.kilnDatabasePool ??
  createPool({
    ...database,
    timezone: "Z",
    connectionLimit: 10,
  })

if (process.env.NODE_ENV !== "production") {
  globalDatabase.kilnDatabasePool = databasePool
}
