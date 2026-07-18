import { describe, expect, it } from "vitest"

import { coreDnsHostnamePattern } from "./lifecycle.js"

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
