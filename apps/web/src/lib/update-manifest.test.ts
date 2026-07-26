import { describe, expect, it } from "vite-plus/test"

import type { KilnReleaseManifest } from "@/effect/github-releases"
import { validateUpdateManifest } from "@/lib/update-manifest"

const manifest: KilnReleaseManifest = {
  channel: "nightly",
  commit: "a".repeat(40),
  compatibility: {
    relayProtocol: 1,
  },
  components: {
    hearth: {
      digest: `sha256:${"b".repeat(64)}`,
      image: "ghcr.io/kiln-site/hearth",
    },
    relay: {
      digest: `sha256:${"c".repeat(64)}`,
      image: "ghcr.io/kiln-site/relay",
    },
  },
  publishedAt: "2026-07-24T00:00:00.000Z",
  schemaVersion: 1,
  version: "0.1.0-nightly.2",
}

describe("update manifest validation", () => {
  it("accepts the current Relay protocol", () => {
    expect(() =>
      validateUpdateManifest(manifest, "0.1.0-nightly.2", "relay")
    ).not.toThrow()
  })

  it("accepts a legacy baked image version on the same release line", () => {
    expect(() =>
      validateUpdateManifest(
        {
          ...manifest,
          imageVersion: "0.1.0-nightly.2",
          version: "0.1.0-nightly.20260725.162524",
        },
        "0.1.0-nightly.20260725.162524",
        "relay"
      )
    ).not.toThrow()
  })

  it("rejects a baked image version from another release line", () => {
    expect(() =>
      validateUpdateManifest(
        {
          ...manifest,
          imageVersion: "0.1.1-nightly.2",
          version: "0.1.0-nightly.20260725.162524",
        },
        "0.1.0-nightly.20260725.162524",
        "relay"
      )
    ).toThrow("image version is invalid")
  })

  it("rejects an incompatible Relay protocol", () => {
    expect(() =>
      validateUpdateManifest(
        {
          ...manifest,
          compatibility: {
            relayProtocol: 2,
          },
        },
        "0.1.0-nightly.2",
        "relay"
      )
    ).toThrow("requires Relay protocol 2")
  })

  it("allows Hearth to cross a Relay protocol transition", () => {
    expect(() =>
      validateUpdateManifest(
        {
          ...manifest,
          compatibility: {
            relayProtocol: 2,
          },
        },
        "0.1.0-nightly.2",
        "hearth"
      )
    ).not.toThrow()
  })
})
