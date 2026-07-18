import { describe, expect, it } from "vitest"
import { relayCatalogSchema } from "@workspace/contracts"

import { BRICKS, brick } from "./bricks.js"

describe("Brick catalog", () => {
  it("publishes a schema-valid Palworld SteamCMD runtime", () => {
    expect(() => relayCatalogSchema.parse({ bricks: BRICKS })).not.toThrow()
    expect(brick("palworld")).toMatchObject({
      defaultMemory: "16G",
      defaultVersion: "latest",
      image: "ghcr.io/kiln-site/ember:palworld",
      javaVersion: "SteamCMD",
    })
  })
})
