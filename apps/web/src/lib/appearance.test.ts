import { describe, expect, it } from "vite-plus/test"

import { parseAccentColor } from "@/lib/appearance"

describe("parseAccentColor", () => {
  it("extracts the default Hearth accent hue and saturation", () => {
    expect(parseAccentColor("#f97316")).toEqual({
      hue: 24.6,
      saturation: 95,
    })
  })

  it("supports neutral colors and rejects incomplete values", () => {
    expect(parseAccentColor("#808080")).toEqual({ hue: 0, saturation: 0 })
    expect(parseAccentColor("#f73")).toBeNull()
    expect(parseAccentColor("f97316")).toBeNull()
  })
})
