import { describe, expect, it } from "vitest"

import { defaultMclogsApiUrl, resolveMclogsApiUrl } from "./mclogs"

describe("resolveMclogsApiUrl", () => {
  it.each([undefined, "", "   "])(
    "uses the default endpoint for %j",
    (configuredUrl) => {
      expect(resolveMclogsApiUrl(configuredUrl)).toBe(defaultMclogsApiUrl)
    }
  )

  it("trims a configured endpoint", () => {
    expect(resolveMclogsApiUrl(" https://logs.example.test/upload ")).toBe(
      "https://logs.example.test/upload"
    )
  })
})
