import { describe, expect, it } from "vite-plus/test"

import {
  discoverPortAllocations,
  dockerPortBindingsForAllocations,
  portAllocationMetadataLabel,
} from "./port-allocations.js"

describe("instance port allocations", () => {
  it("uses live Docker bindings for public ports", () => {
    const label = portAllocationMetadataLabel([
      {
        externalPort: 30_000,
        id: "primary",
        internalPort: 25_565,
        kind: "primary",
        name: "Game port",
        protocol: "tcp",
      },
      {
        externalPort: 30_001,
        id: "a1b2c3d4",
        internalPort: 24_454,
        kind: "custom",
        name: "Voice chat",
        protocol: "udp",
      },
    ])

    expect(
      discoverPortAllocations({
        bindings: {
          "24454/udp": [{ HostPort: "32001" }],
          "25565/tcp": [{ HostPort: "32000" }],
        },
        label,
      })
    ).toEqual([
      {
        externalPort: 32_000,
        id: "primary",
        internalPort: 25_565,
        kind: "primary",
        name: "Game port",
        protocol: "tcp",
      },
      {
        externalPort: 32_001,
        id: "a1b2c3d4",
        internalPort: 24_454,
        kind: "custom",
        name: "Voice chat",
        protocol: "udp",
      },
    ])
  })

  it("does not infer allocations without managed metadata", () => {
    expect(
      discoverPortAllocations({
        bindings: {
          "19132/udp": [{ HostPort: "30132" }],
          "25565/tcp": [{ HostPort: "30565" }],
        },
        label: undefined,
      })
    ).toEqual([])
  })

  it("builds Docker bindings for each protocol and internal port", () => {
    expect(
      dockerPortBindingsForAllocations([
        {
          externalPort: 30_000,
          id: "primary",
          internalPort: 25_565,
          kind: "primary",
          name: "Game port",
          protocol: "tcp",
        },
        {
          externalPort: 30_001,
          id: "a1b2c3d4",
          internalPort: 25_565,
          kind: "custom",
          name: "Query",
          protocol: "udp",
        },
      ])
    ).toEqual({
      "25565/tcp": [{ HostIp: "", HostPort: "30000" }],
      "25565/udp": [{ HostIp: "", HostPort: "30001" }],
    })
  })
})
