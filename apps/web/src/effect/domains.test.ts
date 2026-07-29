import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { Database } from "@/effect/database"
import { loadUsedVanityLabelsEffect } from "@/effect/domains"

describe("domain assignment labels", () => {
  it.effect("excludes the current assignment when checking used labels", () => {
    let query = ""
    let values: Array<string> = []
    const databaseLayer = Layer.succeed(Database)({
      execute: () => Effect.die("Unexpected database write"),
      queryRows: (_operation, sql, parameters) =>
        Effect.sync(() => {
          query = sql
          values = (parameters ?? []).map(String)
          return []
        }),
      transaction: () => Effect.die("Unexpected database transaction"),
    })

    return Effect.gen(function* () {
      yield* loadUsedVanityLabelsEffect("kiln.site", {
        instanceId: "instance-one",
        relayId: "relay-one",
      })
      assert.include(query, "AND NOT (relay_id = ? AND instance_id = ?)")
      assert.deepEqual(values, ["kiln.site", "relay-one", "instance-one"])
    }).pipe(Effect.provide(databaseLayer))
  })
})
