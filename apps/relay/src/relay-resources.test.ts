import { describe, expect, it } from "vite-plus/test"

import { relayOwnsLabels, relayResourceNames } from "./relay-resources.js"

describe("Relay Docker resource scopes", () => {
  it("preserves legacy names for an unscoped Relay", () => {
    const config = { resourceNamespace: null }
    const resources = relayResourceNames(config)

    expect(resources.gameNetwork).toBe("kiln-minecraft")
    expect(resources.instanceContainer("a".repeat(40))).toBe("kiln-aaaaaaaa")
    expect(relayOwnsLabels(config, {})).toBe(true)
    expect(relayOwnsLabels(config, { "kiln.relay.owner": "other" })).toBe(false)
  })

  it("prefixes names and requires the matching owner label", () => {
    const config = { resourceNamespace: "hearth-feature-a1b2c3" }
    const resources = relayResourceNames(config)

    expect(resources.gameNetwork).toBe("hearth-feature-a1b2c3-kiln-minecraft")
    expect(resources.instanceContainer("a".repeat(40))).toBe(
      "hearth-feature-a1b2c3-kiln-aaaaaaaa"
    )
    expect(
      relayOwnsLabels(config, {
        "kiln.relay.owner": "hearth-feature-a1b2c3",
      })
    ).toBe(true)
    expect(relayOwnsLabels(config, {})).toBe(false)
  })
})
