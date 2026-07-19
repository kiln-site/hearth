import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"
import { Context, Effect, Layer } from "effect"

import { DatabaseError } from "./errors"

type QueryValue = boolean | Buffer | Date | null | number | string

export interface DatabaseTransaction {
  readonly execute: (
    sql: string,
    values?: Array<QueryValue>
  ) => Promise<ResultSetHeader>
  readonly queryRows: <TRow extends RowDataPacket>(
    sql: string,
    values?: Array<QueryValue>
  ) => Promise<ReadonlyArray<TRow>>
}

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
    readonly transaction: <TResult>(
      operation: string,
      run: (transaction: DatabaseTransaction) => Promise<TResult>
    ) => Effect.Effect<TResult, DatabaseError>
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
  transaction: (operation, run) =>
    Effect.tryPromise({
      try: async () => {
        const { databasePool } = await import("@/lib/database")
        const connection = await databasePool.getConnection()
        try {
          await connection.beginTransaction()
          const transaction: DatabaseTransaction = {
            execute: async (sql, values) => {
              const [result] = await connection.execute<ResultSetHeader>(
                sql,
                values
              )
              return result
            },
            queryRows: async <TRow extends RowDataPacket>(
              sql: string,
              values?: Array<QueryValue>
            ) => {
              const [rows] = await connection.query<Array<TRow>>(sql, values)
              return rows
            },
          }
          const result = await run(transaction)
          await connection.commit()
          return result
        } catch (cause) {
          await connection.rollback()
          throw cause
        } finally {
          connection.release()
        }
      },
      catch: (cause) => DatabaseError.make({ operation, cause }),
    }).pipe(Effect.withSpan(`db.${operation}`)),
})
