import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise"
import { Context, Effect, Exit, Layer } from "effect"

import { DatabaseError } from "./errors"

type QueryValue = boolean | Buffer | Date | null | number | string

export interface DatabaseTransaction {
  readonly execute: (
    sql: string,
    values?: Array<QueryValue>
  ) => Effect.Effect<ResultSetHeader, DatabaseError>
  readonly queryRows: <TRow extends RowDataPacket>(
    sql: string,
    values?: Array<QueryValue>
  ) => Effect.Effect<ReadonlyArray<TRow>, DatabaseError>
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
    readonly transaction: <TResult, TError, TRequirements>(
      operation: string,
      run: (
        transaction: DatabaseTransaction
      ) => Effect.Effect<TResult, TError, TRequirements>
    ) => Effect.Effect<TResult, DatabaseError | TError, TRequirements>
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
    Effect.acquireUseRelease(
      databasePromise(operation, async () => {
        const { databasePool } = await import("@/lib/database")
        return databasePool.getConnection()
      }),
      (connection) =>
        Effect.gen(function* () {
          yield* databasePromise(operation, () => connection.beginTransaction())
          const result = yield* run(databaseTransaction(connection, operation))
          yield* databasePromise(operation, () => connection.commit())
          return result
        }),
      (connection, exit) =>
        Effect.gen(function* () {
          if (Exit.isSuccess(exit)) {
            yield* Effect.sync(() => {
              connection.release()
            })
            return
          }
          const rollbackExit = yield* databasePromise(operation, () =>
            connection.rollback()
          ).pipe(Effect.exit)
          yield* Effect.sync(() => {
            connection.release()
          })
          yield* rollbackExit
        })
    ).pipe(Effect.withSpan(`db.${operation}`)),
})

function databaseTransaction(
  connection: PoolConnection,
  operation: string
): DatabaseTransaction {
  return {
    execute: (sql, values) =>
      databasePromise(operation, async () => {
        const [result] = await connection.execute<ResultSetHeader>(sql, values)
        return result
      }),
    queryRows: <TRow extends RowDataPacket>(
      sql: string,
      values?: Array<QueryValue>
    ) =>
      databasePromise(operation, async () => {
        const [rows] = await connection.query<Array<TRow>>(sql, values)
        return rows
      }),
  }
}

function databasePromise<TResult>(
  operation: string,
  run: () => PromiseLike<TResult>
): Effect.Effect<TResult, DatabaseError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => DatabaseError.make({ operation, cause }),
  })
}
