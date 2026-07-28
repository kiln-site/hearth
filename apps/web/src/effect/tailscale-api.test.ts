import { describe, expect, it } from "vite-plus/test"

import {
  findTailscaleDevice,
  missingTailscaleOAuthScopes,
  requiredTailscaleOAuthScopes,
} from "./tailscale-api"

describe("Tailscale API integration", () => {
  it("reports only missing Kiln scopes", () => {
    expect(missingTailscaleOAuthScopes(["auth_keys", "dns"])).toEqual([
      "devices:core:read",
      "devices:routes",
    ])
    expect(missingTailscaleOAuthScopes(requiredTailscaleOAuthScopes)).toEqual(
      []
    )
  })

  it("matches a node by its stable Tailscale address before hostname", () => {
    const selected = findTailscaleDevice(
      [
        {
          addresses: ["100.64.12.96"],
          hostname: "renamed-node",
          id: "device-address",
        },
        {
          addresses: ["100.64.99.99"],
          hostname: "kiln-network-node",
          id: "device-hostname",
        },
      ],
      {
        hostname: "kiln-network-node",
        status: { ipv4Address: "100.64.12.96" },
        subnet: "10.187.39.0/24",
      }
    )

    expect(selected?.id).toBe("device-address")
  })

  it("falls back to the node's MagicDNS name", () => {
    const selected = findTailscaleDevice(
      [
        {
          addresses: ["100.64.99.99"],
          id: "device-hostname",
          name: "kiln-network-node.example.ts.net",
        },
      ],
      {
        hostname: "kiln-network-node",
        status: { ipv4Address: null },
        subnet: "10.187.39.0/24",
      }
    )

    expect(selected?.id).toBe("device-hostname")
  })
})
