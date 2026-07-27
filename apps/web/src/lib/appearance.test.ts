import { describe, expect, it } from "vite-plus/test"

import {
  buildDefaultAccentColor,
  nightlyDefaultAccentColor,
  normalizeAppearanceOverride,
  parseAccentColor,
  stableDefaultAccentColor,
} from "@/lib/appearance"

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

describe("appearance defaults", () => {
  it("uses blue fire for nightly builds and orange for stable builds", () => {
    expect(buildDefaultAccentColor("0.2.0-nightly.4")).toBe(
      nightlyDefaultAccentColor
    )
    expect(buildDefaultAccentColor("0.2.0")).toBe(stableDefaultAccentColor)
    expect(buildDefaultAccentColor(undefined)).toBe(stableDefaultAccentColor)
  })

  it("accepts only persisted appearance values from the supported contract", () => {
    expect(
      normalizeAppearanceOverride({
        accentColor: "#38BDF8",
        colorScheme: "light",
      })
    ).toEqual({ accentColor: "#38bdf8", colorScheme: "light" })
    expect(
      normalizeAppearanceOverride({
        accentColor: "orange",
        colorScheme: "system",
      })
    ).toEqual({ accentColor: null, colorScheme: "dark" })
  })
})
