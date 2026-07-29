import { describe, expect, it } from "vite-plus/test"

import {
  dockerPublishedPort,
  instanceConnectAddress,
  publicConnectAddress,
} from "./docker.js"

describe("Docker public game ports", () => {
  it("discovers Docker's assigned primary host port", () => {
    expect(
      dockerPublishedPort(
        {
          "25565/tcp": [
            { HostIp: "0.0.0.0", HostPort: "49172" },
            { HostIp: "::", HostPort: "49172" },
          ],
        },
        25_565,
        "tcp"
      )
    ).toBe(49_172)
  })

  it("ignores missing and invalid bindings", () => {
    expect(dockerPublishedPort({}, 25_565, "tcp")).toBeUndefined()
    expect(
      dockerPublishedPort(
        { "25565/tcp": [{ HostPort: "not-a-port" }] },
        25_565,
        "tcp"
      )
    ).toBeUndefined()
  })

  it("formats IPv4, hostnames, and IPv6 connect addresses", () => {
    expect(publicConnectAddress("relay.example.com", 49_172)).toBe(
      "relay.example.com:49172"
    )
    expect(publicConnectAddress("203.0.113.5", 49_172)).toBe(
      "203.0.113.5:49172"
    )
    expect(publicConnectAddress("2001:db8::5", 49_172)).toBe(
      "[2001:db8::5]:49172"
    )
  })

  it("resolves game addresses without the legacy generated hostname", () => {
    expect(
      instanceConnectAddress({
        gameHost: "games.example.com",
        publicPort: 49_172,
        relayHost: "relay.example.com",
      })
    ).toBe("games.example.com:49172")
    expect(
      instanceConnectAddress({
        discoveredPublicIp: "203.0.113.5",
        publicPort: 49_172,
        relayHost: "relay.example.com",
      })
    ).toBe("203.0.113.5:49172")
    expect(
      instanceConnectAddress({
        publicPort: 49_172,
        relayHost: "relay.example.com",
      })
    ).toBe("relay.example.com:49172")
  })

  it("always prefers Tailscale and reports an unavailable endpoint", () => {
    expect(
      instanceConnectAddress({
        gameHost: "games.example.com",
        publicPort: 49_172,
        relayHost: "relay.example.com",
        tailscaleHost: "paper.kiln.test",
      })
    ).toBe("paper.kiln.test")
    expect(instanceConnectAddress({})).toBe(
      "Error: Relay did not report a connection address"
    )
  })
})
