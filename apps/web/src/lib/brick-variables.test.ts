import { describe, expect, it } from "vitest"

import { updateBrickVariable } from "./brick-variables"

describe("Brick deployment variables", () => {
  it("removes optional values when a field is cleared", () => {
    expect(
      updateBrickVariable(
        { players: 20, version: "latest" },
        "players",
        undefined
      )
    ).toEqual({ version: "latest" })
  })

  it("preserves scalar values without mutating the previous form state", () => {
    const current = { players: 20 }
    expect(updateBrickVariable(current, "players", 32)).toEqual({ players: 32 })
    expect(current).toEqual({ players: 20 })
  })
})
