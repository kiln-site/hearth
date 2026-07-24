import { describe, expect, it } from "vite-plus/test"

import { compareReleaseVersions } from "@/lib/release-version"

const publishedAt = new Map<string, string | null>([
  ["0.1.0-nightly.17", "2026-07-23T00:00:00.000Z"],
  ["0.1.0", "2026-07-24T00:00:00.000Z"],
  ["0.1.0-nightly.19", "2026-07-25T00:00:00.000Z"],
])

describe("release version ordering", () => {
  it("orders same-line stable and nightly releases by publication", () => {
    expect(
      compareReleaseVersions("0.1.0-nightly.19", "0.1.0", publishedAt)
    ).toBe(1)
    expect(
      compareReleaseVersions("0.1.0-nightly.17", "0.1.0", publishedAt)
    ).toBe(-1)
  })

  it("orders different release lines numerically", () => {
    expect(
      compareReleaseVersions("0.2.0-nightly.1", "0.1.0", publishedAt)
    ).toBe(1)
  })

  it("falls back to stable SemVer precedence without publication data", () => {
    expect(compareReleaseVersions("0.1.0", "0.1.0-nightly.19", new Map())).toBe(
      1
    )
  })
})
