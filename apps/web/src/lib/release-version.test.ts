import { describe, expect, it } from "vite-plus/test"

import {
  compareLatestReleaseVersion,
  compareReleaseVersions,
  orderKilnReleases,
} from "@/lib/release-version"

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
    const misleadingPublicationOrder = new Map(publishedAt)
    misleadingPublicationOrder.set(
      "0.2.0-nightly.1",
      "2026-07-22T00:00:00.000Z"
    )
    expect(
      compareReleaseVersions(
        "0.2.0-nightly.1",
        "0.1.0",
        misleadingPublicationOrder
      )
    ).toBe(1)
  })

  it("falls back to stable SemVer precedence without publication data", () => {
    expect(compareReleaseVersions("0.1.0", "0.1.0-nightly.19", new Map())).toBe(
      1
    )
  })

  it("orders GitHub's non-chronological release response numerically", () => {
    const releases = [8, 7, 6, 12, 11, 10, 5].map((nightly) => ({
      publishedAt: `2026-07-26T${String(nightly).padStart(2, "0")}:00:00.000Z`,
      version: `0.1.0-nightly.${nightly}`,
    }))

    expect(
      orderKilnReleases(releases).map((release) => release.version)
    ).toEqual([
      "0.1.0-nightly.12",
      "0.1.0-nightly.11",
      "0.1.0-nightly.10",
      "0.1.0-nightly.8",
      "0.1.0-nightly.7",
      "0.1.0-nightly.6",
      "0.1.0-nightly.5",
    ])
  })

  it("finds the latest release even when the feed is unordered", () => {
    const releases = [8, 7, 6, 12, 11, 10].map((nightly) => ({
      publishedAt: null,
      version: `0.1.0-nightly.${nightly}`,
    }))

    expect(compareLatestReleaseVersion("0.1.0-nightly.12", releases)).toBe(0)
    expect(compareLatestReleaseVersion("0.1.0-nightly.8", releases)).toBe(1)
  })
})
