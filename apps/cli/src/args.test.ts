import { describe, expect, it } from "vite-plus/test"

import { parseArguments } from "./args.js"

describe("CLI arguments", () => {
  it("parses a command with ordinary defaults", () => {
    expect(parseArguments(["servers", "list"])).toMatchObject({
      command: ["servers", "list"],
      follow: false,
      limit: 2_000,
    })
  })

  it("supports command flags in any position", () => {
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
      profile: "automation",
    })
  })

  it("rejects unknown options and unsafe limits", () => {
    expect(() => parseArguments(["--unknown"])).toThrow("Unknown option")
    expect(() => parseArguments(["--limit", "10001"])).toThrow(
      "--limit must be"
    )
  })

  it("rejects removed output mode flags", () => {
    expect(() => parseArguments(["servers", "list", "--json"])).toThrow(
      "Unknown option: --json"
    )
    expect(() => parseArguments(["--output", "human"])).toThrow(
      "Unknown option: --output"
    )
    expect(() => parseArguments(["files", "read", "server", "--raw"])).toThrow(
      "Unknown option: --raw"
    )
  })
})
