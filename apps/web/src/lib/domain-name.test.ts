import { describe, expect, it } from "vite-plus/test"

import { rootDomainForHostname } from "./domain-name"

describe("rootDomainForHostname", () => {
  it.each([
    ["play.example.gg", "example.gg"],
    ["PLAY.Example.CO.UK.", "example.co.uk"],
    ["hearth.preview.orb.local", "orb.local"],
    ["localhost", "localhost"],
    ["127.0.0.1", "127.0.0.1"],
    ["", ""],
  ])("extracts the base domain from %s", (hostname, expected) => {
    expect(rootDomainForHostname(hostname)).toBe(expected)
  })
})
