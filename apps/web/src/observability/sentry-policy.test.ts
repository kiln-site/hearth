import { describe, expect, it } from "vitest"

import { isExpectedAppError, parseSampleRate } from "./sentry-policy"

describe("Sentry policy", () => {
  it("drops expected application failures but keeps operational failures", () => {
    expect(isExpectedAppError({ _tag: "PermissionDeniedError" })).toBe(true)
    expect(
      isExpectedAppError({ _tag: "RelayResponseError", status: 404 })
    ).toBe(true)
    expect(
      isExpectedAppError({ _tag: "RelayResponseError", status: 503 })
    ).toBe(false)
    expect(isExpectedAppError({ _tag: "DatabaseError" })).toBe(false)
    expect(isExpectedAppError(new Error("unexpected"))).toBe(false)
  })

  it("accepts only finite sample rates between zero and one", () => {
    expect(parseSampleRate("0", 0.1)).toBe(0)
    expect(parseSampleRate("0.25", 0.1)).toBe(0.25)
    expect(parseSampleRate("garbage", 0.1)).toBe(0.1)
    expect(parseSampleRate("2", 0.1)).toBe(0.1)
    expect(parseSampleRate("", 0.1)).toBe(0.1)
  })
})
