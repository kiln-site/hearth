import { describe, expect, it } from "vite-plus/test"

import {
  buildDefaultAccentColor,
  defaultAppearance,
  nightlyDefaultAccentColor,
  normalizeAppearanceOverride,
  normalizeAppearancePreferences,
  parseAccentColor,
  resolveAppearance,
  resolveColorScheme,
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
    ).toEqual({ accentColor: null, colorScheme: "system" })
    expect(
      normalizeAppearancePreferences({
        accentColor: "#38bdf8",
        colorScheme: "unsupported",
      })
    ).toEqual({ accentColor: "#38bdf8", colorScheme: "system" })
  })

  it("uses the platform default until a user overrides it", () => {
    const platformDefault = {
      accentColor: "#38bdf8",
      colorScheme: "light",
    } as const

    expect(resolveAppearance(null, platformDefault)).toEqual(platformDefault)
    expect(
      resolveAppearance(
        { accentColor: null, colorScheme: "dark" },
        platformDefault
      )
    ).toEqual({ accentColor: "#38bdf8", colorScheme: "dark" })
    expect(resolveAppearance(null, null)).toEqual(defaultAppearance)
  })

  it("resolves system mode from the operating system preference", () => {
    expect(resolveColorScheme("system", true)).toBe("dark")
    expect(resolveColorScheme("system", false)).toBe("light")
    expect(resolveColorScheme("dark", false)).toBe("dark")
    expect(resolveColorScheme("light", true)).toBe("light")
  })
})
