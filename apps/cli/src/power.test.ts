import { cliPowerResponseSchema } from "@workspace/contracts"
import { assert, describe, it } from "@effect/vitest"

import { formatPowerResponse } from "./power.js"

describe("CLI power responses", () => {
  it("decodes a transitioning power response and reports both states", () => {
    const response = cliPowerResponseSchema.parse(
      JSON.parse(
        JSON.stringify({
          action: "start",
          instance: {
            desiredState: "running",
            id: "a".repeat(40),
            name: "Survival",
            observedState: "starting",
          },
          relayId: "r".repeat(43),
        })
      )
    )

    assert.strictEqual(
      formatPowerResponse(response),
      "Start requested for Survival. State: starting (desired running)."
    )
  })

  it("keeps settled power responses concise", () => {
    const response = cliPowerResponseSchema.parse({
      action: "stop",
      instance: {
        desiredState: "stopped",
        id: "a".repeat(40),
        name: "Survival",
        observedState: "stopped",
      },
      relayId: "r".repeat(43),
    })

    assert.strictEqual(
      formatPowerResponse(response),
      "Stop requested for Survival. State: stopped."
    )
  })
})
