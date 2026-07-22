import { describe, expect, it } from "vite-plus/test"

import {
  exactSourceCidr,
  isSourceAllowed,
  normalizeSourceCidrs,
} from "./source-policy.js"

describe("Relay source policy", () => {
  it("normalizes exact addresses and rejects sources outside the CIDR", () => {
    const policy = normalizeSourceCidrs([
      "192.0.2.19",
      "2001:db8::/48",
      "192.0.2.19/32",
    ])

    expect(policy).toEqual(["192.0.2.19/32", "2001:db8::/48"])
    expect(isSourceAllowed("192.0.2.19", policy)).toBe(true)
    expect(isSourceAllowed("192.0.2.20", policy)).toBe(false)
    expect(isSourceAllowed("2001:db8::42", policy)).toBe(true)
    expect(isSourceAllowed("2001:db9::42", policy)).toBe(false)
  })

  it("handles IPv4-mapped peers and fails closed without a peer", () => {
    expect(exactSourceCidr("::ffff:127.0.0.1")).toBe("127.0.0.1/32")
    expect(isSourceAllowed("::ffff:127.0.0.1", ["127.0.0.0/8"])).toBe(true)
    expect(isSourceAllowed(undefined, ["127.0.0.0/8"])).toBe(false)
    expect(isSourceAllowed(undefined, [])).toBe(true)
  })

  it("rejects malformed and oversized policies", () => {
    expect(() => normalizeSourceCidrs(["192.0.2.1/33"])).toThrow()
    expect(() => normalizeSourceCidrs(Array(17).fill("192.0.2.1"))).toThrow()
  })
})
