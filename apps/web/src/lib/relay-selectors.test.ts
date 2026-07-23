import { describe, expect, it } from "vite-plus/test"
import type { RelayInstance, RelaySnapshot } from "@workspace/contracts"

import {
  relayInstanceRouteId,
  type RelayFleetSnapshot,
} from "@/lib/relay-fleet"
import { replaceRelaySnapshotInstance } from "@/lib/query-options"
import {
  findFirstCanonicalRelayInstance,
  findRelayInstance,
  resolveCanonicalRelayInstance,
  resolveRelayInstance,
  selectInstanceRelayConnected,
  selectInstanceRuntime,
  selectInstanceSettings,
  selectInstanceWorkspaceInstance,
  selectRouteInstances,
  selectServerListInstances,
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
  it("builds route IDs from stable Relay and instance identities", () => {
    expect(relayInstanceRouteId("relay-one", "aaaaaaaa")).toBe(
      "relay-one-aaaaaaaa"
    )
  })

  it("keeps sidebar and workspace data unchanged across resource samples", () => {
    const before = snapshotWithCpu(1)
    const after = snapshotWithCpu(2)

    expect(selectSidebarInstances(after)).toEqual(
      selectSidebarInstances(before)
    )
    expect(selectServerListInstances(after)).toEqual(
      selectServerListInstances(before)
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

  it("keeps sidebar identity stable while route availability changes", () => {
    const connected = snapshotWithCpu(1)
    const unreachable: RelayFleetSnapshot = {
      ...connected,
      instances: connected.instances.map((item) => ({
        ...item,
        relayStatus: "unreachable",
      })),
    }

    expect(selectSidebarInstances(unreachable)).toEqual(
      selectSidebarInstances(connected)
    )
    expect(selectRouteInstances(unreachable)).not.toEqual(
      selectRouteInstances(connected)
    )
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

  it("selects connectivity from the instance's Relay when IDs collide", () => {
    const first = snapshotWithCpu(1).instances[0]
    if (!first) throw new Error("Expected Relay fixture")
    const snapshot = snapshotWithCpu(1)
    snapshot.instances.push({
      ...first,
      relayId: "relay-two",
      relayName: "Relay two",
      relayStatus: "unreachable",
      routeId: "relay-two-aaaaaaaa",
    })

    expect(selectInstanceRelayConnected(first.id, "relay-one")(snapshot)).toBe(
      true
    )
    expect(selectInstanceRelayConnected(first.id, "relay-two")(snapshot)).toBe(
      false
    )
  })

  it("does not select the first server when accessible short IDs collide", () => {
    const first = snapshotWithCpu(1).instances[0]
    if (!first) throw new Error("Expected Relay fixture")
    const snapshot = snapshotWithCpu(1)
    snapshot.instances.push({
      ...first,
      id: "b".repeat(40),
      relayId: "relay-two",
      relayName: "Relay two",
      routeId: "relay-two-aaaaaaaa",
    })

    expect(findRelayInstance(snapshot.instances, first.shortId)).toBeUndefined()
    expect(resolveRelayInstance(snapshot.instances, first.shortId)).toEqual({
      status: "ambiguous",
    })
  })

  it("resolves exactly one accessible short-ID match without exposing misses", () => {
    const snapshot = snapshotWithCpu(1)
    const first = snapshot.instances[0]
    if (!first) throw new Error("Expected Relay fixture")

    expect(resolveRelayInstance(snapshot.instances, first.shortId)).toEqual({
      status: "found",
      instance: first,
    })
    expect(resolveRelayInstance(snapshot.instances, "deadbeef")).toEqual({
      status: "not-found",
    })
  })

  it("keeps a unique legacy Relay-qualified alias resolvable", () => {
    const first = snapshotWithCpu(1).instances[0]
    if (!first) throw new Error("Expected Relay fixture")
    const second = {
      ...first,
      id: "b".repeat(40),
      relayId: "relay-two",
      relayName: "Relay two",
      routeId: "relay-two-aaaaaaaa",
    }
    const snapshot = snapshotWithCpu(1)
    snapshot.instances[0] = {
      ...first,
      routeId: "relay-one-aaaaaaaa",
    }
    snapshot.instances.push(second)

    expect(
      resolveRelayInstance(snapshot.instances, "relay-two-aaaaaaaa")
    ).toEqual({
      status: "found",
      instance: second,
    })
  })

  it("only resolves identifiers whose short URL is unambiguous", () => {
    const first = snapshotWithCpu(1).instances[0]
    if (!first) throw new Error("Expected Relay fixture")
    const snapshot = snapshotWithCpu(1)

    expect(
      resolveCanonicalRelayInstance(snapshot.instances, first.routeId)
    ).toEqual({
      status: "found",
      instance: first,
    })

    snapshot.instances.push({
      ...first,
      id: "b".repeat(40),
      relayId: "relay-two",
      relayName: "Relay two",
      routeId: "relay-two-aaaaaaaa",
    })

    expect(
      resolveCanonicalRelayInstance(snapshot.instances, first.routeId)
    ).toEqual({
      status: "ambiguous",
    })
    expect(
      resolveCanonicalRelayInstance(snapshot.instances, first.shortId)
    ).toEqual({
      status: "ambiguous",
    })
  })

  it("skips colliding short IDs when choosing a sidebar default", () => {
    const first = snapshotWithCpu(1).instances[0]
    if (!first) throw new Error("Expected Relay fixture")
    const collision = {
      ...first,
      id: "b".repeat(40),
      relayId: "relay-two",
      relayName: "Relay two",
      routeId: "relay-two-aaaaaaaa",
    }
    const unique = {
      ...first,
      id: "c".repeat(40),
      relayId: "relay-three",
      relayName: "Relay three",
      routeId: "relay-three-cccccccc",
      shortId: "cccccccc",
    }

    expect(findFirstCanonicalRelayInstance([first, collision, unique])).toEqual(
      unique
    )
    expect(findFirstCanonicalRelayInstance([first, collision])).toBeUndefined()
  })
})
