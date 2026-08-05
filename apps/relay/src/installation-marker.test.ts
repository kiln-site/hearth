import { describe, expect, it } from "vite-plus/test"

import { installationMarkerName } from "./installation-marker.js"

describe("installation marker names", () => {
  it("accepts a server-directory filename", () => {
    expect(installationMarkerName(".kiln-ember-installed")).toBe(
      ".kiln-ember-installed"
    )
  })

  it.each(["", ".", "..", "../ready", "nested/ready", "ready marker"])(
    "rejects %j",
    (value) => {
      expect(installationMarkerName(value)).toBeNull()
    }
  )
})
