import { describe, expect, it } from "vite-plus/test"

import { relayPairingOrigin } from "@/lib/relay-pairing-origin"

describe("Relay pairing origin", () => {
  it("uses the direct listener for the environment-managed Relay CA", () => {
    const origin = relayPairingOrigin({
      browserOrigin: new URL("https://relay.feature.orb.local"),
      caCertificatePem: "managed Relay CA",
      environment: {
        KILN_RELAY_HOST: "relay.feature.orb.local",
        KILN_RELAY_PORT: "4100",
      },
    })

    expect(origin.href).toBe("https://relay.feature.orb.local:4100/")
  })

  it("keeps edge-terminated pairing on the advertised browser origin", () => {
    const browserOrigin = new URL("https://relay.feature.orb.local")
    const origin = relayPairingOrigin({
      browserOrigin,
      caCertificatePem: null,
      environment: {
        KILN_RELAY_HOST: "relay.feature.orb.local",
        KILN_RELAY_PORT: "4100",
      },
    })

    expect(origin).toBe(browserOrigin)
  })

  it("does not redirect an unrelated managed Relay to the local listener", () => {
    const browserOrigin = new URL("https://relay.remote.example")
    const origin = relayPairingOrigin({
      browserOrigin,
      caCertificatePem: "remote Relay CA",
      environment: {
        KILN_RELAY_HOST: "relay.feature.orb.local",
        KILN_RELAY_PORT: "4100",
      },
    })

    expect(origin).toBe(browserOrigin)
  })

  it("prefers a verified bootstrap enrollment origin", () => {
    const enrollmentOrigin = new URL("https://relay.feature.orb.local:4100")
    const origin = relayPairingOrigin({
      browserOrigin: new URL("https://relay.feature.orb.local"),
      caCertificatePem: "managed Relay CA",
      enrollmentOrigin,
      environment: {},
    })

    expect(origin).toBe(enrollmentOrigin)
  })
})
