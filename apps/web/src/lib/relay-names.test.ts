import { describe, expect, it } from "vite-plus/test"

import { relayNameForNewPairing } from "@/lib/relay-names"

describe("Relay names", () => {
  it("increments default names from K100", () => {
    expect(relayNameForNewPairing("K100", [])).toBe("K100")
    expect(relayNameForNewPairing("K100", ["K100"])).toBe("K101")
    expect(relayNameForNewPairing("K100", ["K100", "K101", "Q02"])).toBe("K102")
  })

  it("truncates a custom name only as it is added", () => {
    expect(relayNameForNewPairing("  1234567890123extra  ", [])).toBe(
      "1234567890123"
    )
  })
})
