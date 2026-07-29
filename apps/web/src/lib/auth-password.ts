import type { RowDataPacket } from "mysql2/promise"
import { Effect } from "effect"

import { AuthenticationError } from "@/effect/errors"
import { Database } from "@/effect/database"
import { runAppEffect } from "@/effect/runtime"
import { databaseTable } from "@/lib/database-config"

interface CredentialAccountRow extends RowDataPacket {
  password: string | null
}

const passwordDidNotMatch = () =>
  AuthenticationError.make({
    message: "The account password did not match.",
  })

export async function requireAccountPassword(
  userId: string,
  password: string
): Promise<void> {
  return runAppEffect(
    "auth.password.confirm",
    requireAccountPasswordEffect(userId, password)
  )
}

export const requireAccountPasswordEffect = Effect.fn("auth.password.confirm")(
  function* (userId: string, password: string) {
    const database = yield* Database
    const accounts = yield* database.queryRows<CredentialAccountRow>(
      "auth.passwordAccount",
      `SELECT password
       FROM ${databaseTable("account")}
      WHERE userId = ? AND providerId = 'credential'
      LIMIT 1`,
      [userId]
    )
    const hash = accounts.at(0)?.password
    if (!hash) return yield* passwordDidNotMatch()

    const matches = yield* Effect.tryPromise({
      try: async () => {
        const { auth } = await import("@/lib/auth")
        const context = await auth.$context
        return context.password.verify({ hash, password })
      },
      catch: (cause) =>
        AuthenticationError.make({
          message: "The account password could not be verified.",
          cause,
        }),
    })
    if (!matches) return yield* passwordDidNotMatch()
  }
)
