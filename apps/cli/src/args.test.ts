import { describe, expect, it } from "vite-plus/test"

import { parseArguments } from "./args.js"

describe("CLI arguments", () => {
  it("defaults to deterministic JSON output", () => {
    expect(parseArguments(["servers", "list"])).toMatchObject({
      command: ["servers", "list"],
      follow: false,
      limit: 2_000,
      output: "json",
      raw: false,
    })
  })

  it("supports agent-oriented flags in any position", () => {
    expect(
      parseArguments([
        "--profile=automation",
        "server",
        "logs",
        "relay:instance",
        "--follow",
        "--limit",
        "500",
      ])
    ).toMatchObject({
      command: ["server", "logs", "relay:instance"],
      follow: true,
      limit: 500,
      output: "json",
      profile: "automation",
    })
  })

  it("rejects unknown options and unsafe limits", () => {
    expect(() => parseArguments(["--unknown"])).toThrow("Unknown option")
    expect(() => parseArguments(["--limit", "10001"])).toThrow(
      "--limit must be"
    )
  })
})
