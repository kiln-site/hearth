import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"

import { resolveConsoleStopCommands } from "./docker.js"

describe("console stop commands", () => {
  it.effect("refreshes an empty legacy label from its live recipe", () =>
    Effect.gen(function* () {
      let loads = 0
      const commands = yield* resolveConsoleStopCommands({
        configured: [],
        instanceId: "a".repeat(40),
        load: async () => {
          loads += 1
          return ["stop", "/stop"]
        },
        source: "https://example.com/paper.yml",
      })

      assert.deepStrictEqual(commands, ["stop", "/stop"])
      assert.strictEqual(loads, 1)
    })
  )

  it.effect("uses a non-empty container label without loading the recipe", () =>
    Effect.gen(function* () {
      let loads = 0
      const commands = yield* resolveConsoleStopCommands({
        configured: ["end"],
        instanceId: "b".repeat(40),
        load: async () => {
          loads += 1
          return ["stop"]
        },
        source: "https://example.com/velocity.yml",
      })

      assert.deepStrictEqual(commands, ["end"])
      assert.strictEqual(loads, 0)
    })
  )
})
