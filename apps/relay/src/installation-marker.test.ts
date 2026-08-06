import { describe, expect, it } from "vite-plus/test"

import {
  installationMarkerName,
  supportsInstallationMarkerProtocol,
} from "./installation-marker.js"

describe("installation marker names", () => {
  it("accepts a server-directory filename", () => {
    expect(installationMarkerName(".kiln-ember-installed")).toBe(
      ".kiln-ember-installed"
    )
  })

  it.each([
    "",
    ".",
    "..",
    ".kiln-",
    ".KILN-ready",
    "paper.jar",
    "server.properties",
    "../.kiln-ready",
    "nested/.kiln-ready",
    ".kiln-ready marker",
    `.kiln-${"a".repeat(59)}`,
  ])("rejects %j", (value) => {
    expect(installationMarkerName(value)).toBeNull()
  })
})

describe("installation marker protocol", () => {
  it("requires an explicit v1 image capability", () => {
    expect(supportsInstallationMarkerProtocol("v1")).toBe(true)
    expect(supportsInstallationMarkerProtocol(undefined)).toBe(false)
    expect(supportsInstallationMarkerProtocol("<no value>")).toBe(false)
    expect(supportsInstallationMarkerProtocol("v2")).toBe(false)
  })
})
