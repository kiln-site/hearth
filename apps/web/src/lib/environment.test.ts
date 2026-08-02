import { afterEach, describe, expect, it } from "vitest"

import { kilnRootDomain } from "./environment"

const originalKilnUrl = process.env.KILN_URL

afterEach(() => {
  if (originalKilnUrl === undefined) delete process.env.KILN_URL
  else process.env.KILN_URL = originalKilnUrl
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
