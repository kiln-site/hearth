import { relayInstanceResourcesSchema } from "@workspace/contracts"
import { describe, expect, it } from "vite-plus/test"

import { resourceHistoryStore } from "./resource-history-store"

describe("Resource history store", () => {
  it("records CPU, memory, network, and node disk while folder usage is unknown", () => {
    const resources = relayInstanceResourcesSchema.parse({
      sampledAt: new Date().toISOString(),
      cpu: { capacityPercent: 800, percent: 125.5 },
      memory: {
        percent: 50,
        totalBytes: 2 * 1024 ** 3,
        usedBytes: 1024 ** 3,
      },
      network: {
        receivedBytes: 12_345,
        receivedBytesPerSecond: 456,
        sentBytes: 6_789,
        sentBytesPerSecond: 123,
      },
      storage: {
        nodePercent: 40,
        nodeTotalBytes: 590 * 1024 ** 3,
        nodeUsedBytes: 236 * 1024 ** 3,
        percent: null,
        totalBytes: 25 * 1024 ** 3,
        usedBytes: null,
      },
    })
    const store = resourceHistoryStore("pending-disk", "instance")

    store.record([], resources)

    expect(store.getSnapshot()).toEqual([
      {
        cpu: 125.5,
        memory: 50,
        network: 579,
        networkReceived: 456,
        networkSent: 123,
        storage: null,
        storageNode: 40,
        timestamp: Date.parse(resources.sampledAt),
      },
    ])
  })
})
