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
})
