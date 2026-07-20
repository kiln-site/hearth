import { describe, expect, it } from "vite-plus/test"
import type { RelayInstance, RelaySnapshot } from "@workspace/contracts"

import type { RelayFleetSnapshot } from "@/lib/relay-fleet"
import { replaceRelaySnapshotInstance } from "@/lib/query-options"
import {
  selectInstanceRuntime,
  selectInstanceSettings,
  selectInstanceWorkspaceInstance,
  selectSidebarInstances,
} from "@/lib/relay-selectors"

const instance = {
  connectAddress: "minecraft.test:25565",
  game: "Minecraft",
  id: "a".repeat(40),
  implementation: "Fabric",
  javaVersion: "21",
  name: "Test server",
  observedState: "running",
  resources: {
    sampledAt: "2026-07-20T12:00:00.000Z",
    cpu: { percent: 12 },
    memory: { percent: 25, totalBytes: 100, usedBytes: 25 },
    storage: { percent: 40, totalBytes: 100, usedBytes: 40 },
  },
  service: "test-server",
  shortId: "aaaaaaaa",
  startedAt: "2026-07-20T11:00:00.000Z",
  version: "1.21.11",
} as RelayInstance

function snapshotWithCpu(percent: number): RelayFleetSnapshot {
  return {
    instances: [
      {
        ...instance,
        relayId: "relay-one",
        relayName: "Relay one",
        relayStatus: "connected",
        routeId: "aaaaaaaa",
        resources: {
          ...instance.resources!,
          sampledAt: `2026-07-20T12:00:0${percent}.000Z`,
          cpu: { percent },
        },
      },
    ],
    nodes: [
      {
        ...({} as RelaySnapshot["node"]),
        relayId: "relay-one",
        relayName: "Relay one",
        relayStatus: "connected",
      },
    ],
  }
}

describe("Relay render selectors", () => {
  it("keeps sidebar and workspace data unchanged across resource samples", () => {
    const before = snapshotWithCpu(1)
    const after = snapshotWithCpu(2)

    expect(selectSidebarInstances(after)).toEqual(
      selectSidebarInstances(before)
    )
    expect(selectInstanceWorkspaceInstance(instance.id)(after)).toEqual(
      selectInstanceWorkspaceInstance(instance.id)(before)
    )
    expect(selectInstanceSettings(instance.id)(after)).toEqual(
      selectInstanceSettings(instance.id)(before)
    )
  })

  it("continues publishing each resource sample to the runtime subscriber", () => {
    const before = selectInstanceRuntime(instance.id)(snapshotWithCpu(1))
    const after = selectInstanceRuntime(instance.id)(snapshotWithCpu(2))

    expect(before?.resources?.cpu.percent).toBe(1)
    expect(after?.resources?.cpu.percent).toBe(2)
    expect(after?.resources?.sampledAt).not.toBe(before?.resources?.sampledAt)
  })

  it("updates only the matching Relay when local instance IDs collide", () => {
    const first = snapshotWithCpu(1).instances[0]
    if (!first) throw new Error("Expected Relay fixture")
    const second = {
      ...first,
      relayId: "relay-two",
      relayName: "Relay two",
      routeId: "relay-two-aaaaaaaa",
    }
    const snapshot = snapshotWithCpu(1)
    snapshot.instances.push(second)

    const updated = replaceRelaySnapshotInstance(snapshot, {
      ...first,
      name: "Renamed on Relay one",
    })

    expect(updated?.instances.map((item) => item.name)).toEqual([
      "Renamed on Relay one",
      "Test server",
    ])
  })
})
