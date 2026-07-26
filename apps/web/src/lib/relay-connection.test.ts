import { describe, expect, it } from "vite-plus/test"

import { relayControlEndpoint } from "@/lib/relay-control-endpoint"

const relay = {
  hostname: "relay.feature.orb.local",
  id: "relay-id",
  managedTls: true,
  port: 443,
  useTls: true,
}

describe("Relay control endpoint", () => {
  it("uses the direct TLS listener for the environment-managed Relay CA", () => {
    expect(
      relayControlEndpoint(relay, {
        KILN_RELAY_HOST: "relay.feature.orb.local",
        KILN_RELAY_PORT: "4100",
      })
    ).toEqual({
      ...relay,
      port: 4100,
      useTls: true,
    })
  })

  it("keeps edge-terminated Relay control on its advertised endpoint", () => {
    expect(
      relayControlEndpoint(
        { ...relay, managedTls: false },
        {
          KILN_RELAY_HOST: "relay.feature.orb.local",
          KILN_RELAY_PORT: "4100",
        }
      )
    ).toEqual({ ...relay, managedTls: false })
  })

  it("preserves an explicit control endpoint override", () => {
    expect(
      relayControlEndpoint(relay, {
        KILN_RELAY_CONTROL_URL: "ws://relay:4100",
        KILN_RELAY_HOST: "relay.feature.orb.local",
      })
    ).toEqual({
      ...relay,
      hostname: "relay",
      port: 4100,
      useTls: false,
    })
  })

  it("does not redirect an unrelated Relay", () => {
    expect(
      relayControlEndpoint(
        { ...relay, hostname: "relay.remote.example" },
        {
          KILN_RELAY_HOST: "relay.feature.orb.local",
          KILN_RELAY_PORT: "4100",
        }
      )
    ).toEqual({ ...relay, hostname: "relay.remote.example" })
  })
})
