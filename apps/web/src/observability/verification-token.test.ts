import { describe, expect, it } from "vitest"

import { matchesVerificationToken } from "./verification-token"

describe("Sentry verification token", () => {
  it("requires an exact bearer token match", () => {
    expect(matchesVerificationToken("Bearer kiln-secret", "kiln-secret")).toBe(
      true
    )
    expect(matchesVerificationToken("Bearer kiln-secrex", "kiln-secret")).toBe(
      false
    )
    expect(matchesVerificationToken("Bearer short", "kiln-secret")).toBe(false)
    expect(matchesVerificationToken(null, "kiln-secret")).toBe(false)
    expect(matchesVerificationToken("Bearer kiln-secret", undefined)).toBe(false)
  })
})
