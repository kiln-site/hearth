import { describe, expect, it } from "vite-plus/test"

import {
  domainNameSchema,
  validateBlacklistPatterns,
  vanityLabelAllowed,
  vanityLabelSchema,
} from "@/lib/domain-schemas"
import { cloudflareAddressRecord } from "@/effect/cloudflare-api"
import {
  defaultSrvService,
  generateVanityCandidates,
} from "@/server/vanity-names"

describe("managed game domains", () => {
  it("normalizes valid domains and vanity labels", () => {
    expect(domainNameSchema.parse(".PLAY.Example.COM.")).toBe(
      "play.example.com"
    )
    expect(vanityLabelSchema.parse("  My-Server ")).toBe("my-server")
  })

  it("validates administrator blacklist patterns", () => {
    const patterns = validateBlacklistPatterns(["^(admin|api)$", "^staff-"])
    expect(vanityLabelAllowed("api", patterns)).toBe(false)
    expect(vanityLabelAllowed("staff-lobby", patterns)).toBe(false)
    expect(vanityLabelAllowed("survival", patterns)).toBe(true)
    expect(() => validateBlacklistPatterns(["["])).toThrow(
      "Blacklist pattern 1 is not valid"
    )
  })

  it("applies the blacklist to generated names", () => {
    expect(generateVanityCandidates([], 2, () => 0)).toEqual([
      "amber-anvil",
      "amber-anvil-100",
    ])
    expect(() => generateVanityCandidates(["^amber"], 1, () => 0)).toThrow(
      "blacklist excludes every generated vanity name"
    )
  })

  it("selects the Cloudflare record type for each Relay host", () => {
    expect(cloudflareAddressRecord("play.example.com", "203.0.113.8")).toEqual({
      content: "203.0.113.8",
      name: "play.example.com",
      type: "A",
    })
    expect(
      cloudflareAddressRecord("play.example.com", "2001:db8::8").type
    ).toBe("AAAA")
    expect(
      cloudflareAddressRecord("play.example.com", "relay.example.net").type
    ).toBe("CNAME")
  })

  it("derives a stable SRV service name from the Brick game", () => {
    expect(defaultSrvService("Minecraft")).toBe("minecraft")
    expect(defaultSrvService("Space Engineers")).toBe("space-engineers")
  })
})
