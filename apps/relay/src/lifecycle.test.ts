import { describe, expect, it } from "vite-plus/test"

import { coreDnsHostnamePattern, velocityForcedHosts } from "./lifecycle.js"

describe("CoreDNS Brick hostnames", () => {
  it("matches only deployed hostnames and implementation aliases", () => {
    const expression = coreDnsHostnamePattern("kiln.test", [
      "1.21.11.paper.kiln.test",
      "paper.kiln.test",
      "palworld.kiln.test:8211",
      "outside.example",
    ])
    const pattern = new RegExp(expression.replace(/^\(\?i\)/u, ""), "iu")

    expect(pattern.test("1.21.11.paper.kiln.test.")).toBe(true)
    expect(pattern.test("PAPER.KILN.TEST.")).toBe(true)
    expect(pattern.test("palworld.kiln.test.")).toBe(false)
    expect(pattern.test("kiln.test.")).toBe(false)
    expect(pattern.test("typo.kiln.test.")).toBe(false)
    expect(pattern.test("outside.example.")).toBe(false)
  })

  it("matches nothing before the first Brick is deployed", () => {
    const pattern = new RegExp(coreDnsHostnamePattern("kiln.test", []), "u")
    expect(pattern.test("kiln.test.")).toBe(false)
    expect(pattern.test("anything.kiln.test.")).toBe(false)
  })
})

describe("Velocity forced hosts", () => {
  it("coalesces the default Brick hostname with its implementation alias", () => {
    const forcedHosts = velocityForcedHosts("kiln.test", [
      {
        hostname: "paper.kiln.test",
        implementation: "paper",
        name: "kiln-paper-one",
        target: "kiln-paper-one:25565",
        version: "1.21.11",
      },
      {
        hostname: "paper.kiln.test",
        implementation: "paper",
        name: "kiln-paper-two",
        target: "kiln-paper-two:25565",
        version: "1.21.10",
      },
    ])

    expect(forcedHosts).toBe(
      '"paper.kiln.test" = ["kiln-paper-one", "kiln-paper-two", "limbo"]'
    )
    expect(forcedHosts.match(/"paper[.]kiln[.]test"/gu)).toHaveLength(1)
  })

  it("keeps a version hostname separate from its implementation alias", () => {
    const forcedHosts = velocityForcedHosts("kiln.test", [
      {
        hostname: "1.21.11.paper.kiln.test",
        implementation: "paper",
        name: "kiln-paper-one",
        target: "kiln-paper-one:25565",
        version: "1.21.11",
      },
    ])

    expect(forcedHosts).toContain(
      '"1.21.11.paper.kiln.test" = ["kiln-paper-one", "limbo"]'
    )
    expect(forcedHosts).toContain(
      '"paper.kiln.test" = ["kiln-paper-one", "limbo"]'
    )
  })
})
