import { relayInstanceSchema } from "@workspace/contracts"
import { describe, expect, it } from "vite-plus/test"

import { applyStoredInstanceNames } from "./instance-names.js"

function instance(id: string, name: string) {
  return relayInstanceSchema.parse({
    connectAddress: `${name}.test`,
    containerId: null,
    desiredState: "running",
    directory: id,
    game: "Minecraft",
    id,
    implementation: "Paper",
    javaVersion: "21",
    managedByRelay: true,
    name,
    observedState: "running",
    service: `kiln-${name}`,
    shortId: id.slice(0, 8),
    startedAt: null,
    status: "running",
    version: "1.21.11",
  })
}

describe("Relay instance names", () => {
  it("overlays Relay-owned names on snapshots and mutation responses", () => {
    const first = instance("a".repeat(40), "paper-one")
    const second = instance("b".repeat(40), "paper-two")

    expect(
      applyStoredInstanceNames(
        [first, second],
        [
          { instanceId: first.id, name: "Survival" },
          { instanceId: second.id, name: "Survival" },
        ]
      ).map(({ name }) => name)
    ).toEqual(["Survival", "Survival"])
  })
})
