import type { RelaySnapshot } from "@workspace/contracts"
import { describe, expect, it } from "vite-plus/test"

import { RelaySnapshotHub } from "./snapshot-hub.js"

describe("Relay snapshot hub", () => {
  it("coalesces concurrent samples and replays one shared result", async () => {
    let loads = 0
    let finishLoad: ((snapshot: RelaySnapshot) => void) | undefined
    const snapshot = { instances: [] } as unknown as RelaySnapshot
    const hub = new RelaySnapshotHub(
      () =>
        new Promise<RelaySnapshot>((resolve) => {
          loads += 1
          finishLoad = resolve
        }),
      60_000
    )

    const first = hub.read()
    const second = hub.read()
    expect(loads).toBe(1)
    finishLoad?.(snapshot)
    await expect(first).resolves.toBe(snapshot)
    await expect(second).resolves.toBe(snapshot)

    const samples: Array<RelaySnapshot> = []
    const unsubscribe = hub.subscribe((sample) => samples.push(sample.snapshot))
    expect(samples).toEqual([snapshot])
    expect(await hub.read()).toBe(snapshot)
    expect(loads).toBe(1)

    unsubscribe()
    hub.close()
  })

  it("forces a fresh sample after a mutation", async () => {
    let current = { instances: [] } as unknown as RelaySnapshot
    const hub = new RelaySnapshotHub(() => Promise.resolve(current), 60_000)

    expect(await hub.read()).toBe(current)
    current = {
      instances: [{ id: "instance-a", name: "Renamed" }],
    } as unknown as RelaySnapshot

    expect(await hub.read()).not.toBe(current)
    expect(await hub.refresh()).toBe(current)
    expect(await hub.read()).toBe(current)
    hub.close()
  })

  it("refreshes after an in-flight sample fails", async () => {
    const recovered = emptySnapshot()
    let loads = 0
    let failSample: ((cause: Error) => void) | undefined
    const hub = new RelaySnapshotHub(() => {
      loads += 1
      return loads === 1
        ? new Promise<RelaySnapshot>((_resolve, reject) => {
            failSample = reject
          })
        : Promise.resolve(recovered)
    }, 60_000)

    const failedSample = hub.read()
    const refresh = hub.refresh()
    failSample?.(new Error("Sample failed"))

    await expect(failedSample).rejects.toThrow("Sample failed")
    await expect(refresh).resolves.toBe(recovered)
    expect(loads).toBe(2)
    hub.close()
  })

  it("isolates subscribers and interrupts in-flight delivery when closed", async () => {
    let finishLoad: ((snapshot: RelaySnapshot) => void) | undefined
    const snapshot = { instances: [] } as unknown as RelaySnapshot
    const delivered: Array<RelaySnapshot> = []
    const hub = new RelaySnapshotHub(
      () =>
        new Promise<RelaySnapshot>((resolve) => {
          finishLoad = resolve
        }),
      60_000
    )

    hub.subscribe(() => {
      throw new Error("subscriber failed")
    })
    hub.subscribe((sample) => delivered.push(sample.snapshot))
    finishLoad?.(snapshot)
    expect(await hub.read()).toBe(snapshot)
    expect(delivered).toEqual([snapshot])

    const closingHub = new RelaySnapshotHub(
      () =>
        new Promise<RelaySnapshot>((resolve) => {
          finishLoad = resolve
        }),
      60_000
    )
    closingHub.subscribe((sample) => delivered.push(sample.snapshot))
    closingHub.close()
    finishLoad?.(snapshot)
    await Promise.resolve()
    expect(delivered).toEqual([snapshot])
    expect(() => closingHub.subscribe(() => undefined)).toThrow(
      "Relay snapshot hub is closed"
    )
    hub.close()
  })
})

function emptySnapshot(): RelaySnapshot {
  return {
    instances: [],
    node: {
      arch: "arm64",
      capabilities: [],
      canProvisionInstances: true,
      connectedAt: "2026-08-08T12:00:00.000Z",
      cpu: { cores: 8, loadPercent: 10 },
      docker: { available: true, version: "28.0.0" },
      id: "relay-test",
      memory: { totalBytes: 16_000, usedBytes: 8_000 },
      name: "Test Relay",
      platform: "linux",
      startedAt: "2026-08-08T11:00:00.000Z",
      storage: { totalBytes: 100_000, usedBytes: 50_000 },
      uptimeSeconds: 3_600,
      version: "0.1.0",
    },
  }
}
