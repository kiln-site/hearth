import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"
import { Context, Effect, Layer } from "effect"

import { DatabaseError } from "./errors"

type QueryValue = boolean | Buffer | Date | null | number | string

export class Database extends Context.Service<
  Database,
  {
    readonly execute: (
      operation: string,
      sql: string,
      values?: Array<QueryValue>
    ) => Effect.Effect<ResultSetHeader, DatabaseError>
    readonly queryRows: <TRow extends RowDataPacket>(
      operation: string,
      sql: string,
      values?: Array<QueryValue>
    ) => Effect.Effect<ReadonlyArray<TRow>, DatabaseError>
  }
>()("kiln/Database") {}

export const DatabaseLive = Layer.succeed(Database)({
  execute: (operation, sql, values) =>
    Effect.tryPromise({
      try: async () => {
        const { databasePool } = await import("@/lib/database")
        const [result] = await databasePool.execute<ResultSetHeader>(
          sql,
          values
        )
        return result
      },
      catch: (cause) => DatabaseError.make({ operation, cause }),
    }).pipe(Effect.withSpan(`db.${operation}`)),
  queryRows: <TRow extends RowDataPacket>(
    operation: string,
    sql: string,
    values?: Array<QueryValue>
  ) =>
    Effect.tryPromise({
      try: async () => {
        const { databasePool } = await import("@/lib/database")
        const [rows] = await databasePool.query<Array<TRow>>(sql, values)
        return rows
      },
      catch: (cause) => DatabaseError.make({ operation, cause }),
    }).pipe(Effect.withSpan(`db.${operation}`)),
})
