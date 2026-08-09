import { describe, expect, it } from "vite-plus/test"

import { formatBytes, renderTable } from "./output.js"

describe("CLI output", () => {
  it("renders aligned text tables", () => {
    expect(
      renderTable(
        ["NAME", "STATE", "ID"],
        [
          ["Survival", "running", "relay:one"],
          ["Creative", "offline", "relay:two"],
        ]
      )
    ).toBe(
      [
        "NAME      STATE    ID",
        "Survival  running  relay:one",
        "Creative  offline  relay:two",
      ].join("\n")
    )
  })

  it("formats file sizes for people", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1_536)).toBe("1.5 KiB")
    expect(formatBytes(10 * 1_024 * 1_024)).toBe("10 MiB")
  })
})
