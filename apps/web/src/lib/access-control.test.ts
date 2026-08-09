import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import type { ResultSetHeader } from "mysql2/promise"

import { Database } from "@/effect/database"
import {
  deduplicateEffectiveInstanceGrants,
  deleteInstanceAccessEffect,
  isBlockedInstanceOwnerRoleChange,
  isCurrentInstanceOwnerGrant,
  isProtectedInstanceOwnerGrant,
} from "@/lib/access-control"

const emptyResult: ResultSetHeader = {
  affectedRows: 0,
  changedRows: 0,
  constructor: { name: "ResultSetHeader" },
  fieldCount: 0,
  info: "",
  insertId: 0,
  serverStatus: 0,
  warningStatus: 0,
}

describe("instance access cleanup", () => {
  it("shows each user once and prefers a direct instance grant", () => {
    const grants: Array<{
      id: string
      resourceType: "instance" | "relay"
      userId: string
    }> = [
      {
        id: "direct-one",
        resourceType: "instance",
        userId: "user-one",
      },
      {
        id: "relay-two",
        resourceType: "relay",
        userId: "user-two",
      },
      {
        id: "relay-one",
        resourceType: "relay",
        userId: "user-one",
      },
      {
        id: "direct-two",
        resourceType: "instance",
        userId: "user-two",
      },
      {
        id: "relay-three",
        resourceType: "relay",
        userId: "user-three",
      },
    ]
    assert.deepEqual(deduplicateEffectiveInstanceGrants(grants), [
      {
        id: "direct-one",
        resourceType: "instance",
        userId: "user-one",
      },
      {
        id: "direct-two",
        resourceType: "instance",
        userId: "user-two",
      },
      {
        id: "relay-three",
        resourceType: "relay",
        userId: "user-three",
      },
    ])
  })

  it("protects the current owner and any remaining owner-role grant", () => {
    assert.isTrue(
      isCurrentInstanceOwnerGrant({
        grantUserId: "owner-one",
        ownerId: "owner-one",
      })
    )
    assert.isTrue(
      isProtectedInstanceOwnerGrant({
        grantRole: "admin",
        grantUserId: "owner-one",
        ownerId: "owner-one",
      })
    )
    assert.isTrue(
      isProtectedInstanceOwnerGrant({
        grantRole: "owner",
        grantUserId: "owner-two",
        ownerId: null,
      })
    )
    assert.isFalse(
      isProtectedInstanceOwnerGrant({
        grantRole: "admin",
        grantUserId: "member-one",
        ownerId: "owner-one",
      })
    )
  })

  it("only allows the persisted owner's grant to retain or regain owner", () => {
    assert.isTrue(
      isBlockedInstanceOwnerRoleChange({
        grantRole: "admin",
        grantUserId: "owner-one",
        nextRole: "viewer",
        ownerId: "owner-one",
      })
    )
    assert.isFalse(
      isBlockedInstanceOwnerRoleChange({
        grantRole: "admin",
        grantUserId: "owner-one",
        nextRole: "owner",
        ownerId: "owner-one",
      })
    )
    assert.isFalse(
      isBlockedInstanceOwnerRoleChange({
        grantRole: "owner",
        grantUserId: "former-owner",
        nextRole: "admin",
        ownerId: "owner-one",
      })
    )
    assert.isFalse(
      isBlockedInstanceOwnerRoleChange({
        grantRole: "admin",
        grantUserId: "owner-one",
        nextRole: "admin",
        ownerId: "owner-one",
      })
    )
  })

  it.effect("removes grants and pending invitations in one transaction", () => {
    const statements: Array<{
      sql: string
      values: ReadonlyArray<unknown>
    }> = []
    const databaseLayer = Layer.succeed(Database)({
      execute: () => Effect.die("Unexpected standalone database write"),
      queryRows: () => Effect.die("Unexpected database query"),
      transaction: (_operation, run) =>
        run({
          execute: (sql, values) =>
            Effect.sync(() => {
              statements.push({ sql, values: values ?? [] })
              return emptyResult
            }),
          queryRows: () => Effect.succeed([]),
        }),
    })

    return Effect.gen(function* () {
      yield* deleteInstanceAccessEffect("relay-one", "instance-one")

      assert.strictEqual(statements.length, 2)
      assert.include(statements[0]?.sql, "resource_type = 'instance'")
      assert.deepEqual(statements[0]?.values, ["relay-one", "instance-one"])
      assert.include(statements[1]?.sql, "accepted_at IS NULL")
      assert.include(statements[1]?.sql, "revoked_at IS NULL")
      assert.include(statements[1]?.sql, "expires_at > CURRENT_TIMESTAMP(3)")
      assert.deepEqual(statements[1]?.values, ["relay-one", "instance-one"])
    }).pipe(Effect.provide(databaseLayer))
  })
})
