import { afterEach, describe, expect, it } from "vite-plus/test"

import {
  cliDefaultAccessDays,
  kilnInstallationId,
  kilnRootDomain,
} from "./environment"

const originalKilnUrl = process.env.KILN_URL
const originalCliDefaultAccessDays = process.env.KILN_CLI_DEFAULT_ACCESS_DAYS
const originalKilnInstallationId = process.env.KILN_INSTALLATION_ID

afterEach(() => {
  if (originalKilnUrl === undefined) delete process.env.KILN_URL
  else process.env.KILN_URL = originalKilnUrl
  if (originalCliDefaultAccessDays === undefined) {
    delete process.env.KILN_CLI_DEFAULT_ACCESS_DAYS
  } else {
    process.env.KILN_CLI_DEFAULT_ACCESS_DAYS = originalCliDefaultAccessDays
  }
  if (originalKilnInstallationId === undefined) {
    delete process.env.KILN_INSTALLATION_ID
  } else {
    process.env.KILN_INSTALLATION_ID = originalKilnInstallationId
  }
})

describe("kilnInstallationId", () => {
  it("uses a stable safe default and validates deployment IDs", () => {
    delete process.env.KILN_INSTALLATION_ID
    expect(kilnInstallationId()).toBe("kiln")
    process.env.KILN_INSTALLATION_ID = "kiln-production_1"
    expect(kilnInstallationId()).toBe("kiln-production_1")
    process.env.KILN_INSTALLATION_ID = "not/a/key-segment"
    expect(() => kilnInstallationId()).toThrow("KILN_INSTALLATION_ID")
  })
})

describe("cliDefaultAccessDays", () => {
  it("defaults full CLI access to 30 days", () => {
    delete process.env.KILN_CLI_DEFAULT_ACCESS_DAYS
    expect(cliDefaultAccessDays()).toBe(30)
  })

  it("accepts a bounded deployment override", () => {
    process.env.KILN_CLI_DEFAULT_ACCESS_DAYS = "14"
    expect(cliDefaultAccessDays()).toBe(14)
  })

  it.each(["0", "366", "1.5", "never"])(
    "rejects invalid values (%s)",
    (value) => {
      process.env.KILN_CLI_DEFAULT_ACCESS_DAYS = value
      expect(() => cliDefaultAccessDays()).toThrow(
        "KILN_CLI_DEFAULT_ACCESS_DAYS"
      )
    }
  )
})

describe("kilnRootDomain", () => {
  it.each([
    ["https://hearth.kiln.site", "kiln.site"],
    ["https://panel.example.co.uk/path", "example.co.uk"],
    ["https://hearth.preview.orb.local", "orb.local"],
    ["http://localhost:3000", "localhost"],
    ["http://127.0.0.1:3000", "127.0.0.1"],
  ])("extracts the base domain from %s", (url, expected) => {
    process.env.KILN_URL = url
    expect(kilnRootDomain()).toBe(expected)
  })
})
