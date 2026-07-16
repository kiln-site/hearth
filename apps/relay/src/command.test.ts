import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"

import { commandEffect } from "./command.js"

describe("commandEffect", () => {
  it.effect("captures stdout in the typed Effect boundary", () =>
    Effect.gen(function* () {
      const result = yield* commandEffect(process.execPath, [
        "-e",
        "process.stdout.write('kiln')",
      ])
      assert.strictEqual(result.stdout, "kiln")
      assert.strictEqual(result.stderr, "")
    })
  )

  it.effect("returns a tagged command failure", () =>
    Effect.gen(function* () {
      const error = yield* commandEffect(process.execPath, [
        "-e",
        "process.exit(2)",
      ]).pipe(Effect.flip)
      assert.strictEqual(error._tag, "CommandError")
      assert.strictEqual(error.executable, process.execPath)
    })
  )
})
