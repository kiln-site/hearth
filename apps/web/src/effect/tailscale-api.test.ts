import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import {
  findTailscaleDevice,
  missingTailscaleOAuthScopes,
  requiredTailscaleOAuthScopes,
  syncTailscaleControlPlaneEffect,
  verifyTailscaleOAuthCredentialEffect,
} from "./tailscale-api"

describe("Tailscale API integration", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

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

  it("verifies requested scopes and tags without treating the client as an auth key", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          access_token: "access-token",
          expires_in: 3_600,
          scope: requiredTailscaleOAuthScopes.join(" "),
          token_type: "Bearer",
        })
    )
    vi.stubGlobal("fetch", fetchMock)

    const verified = await Effect.runPromise(
      verifyTailscaleOAuthCredentialEffect(
        "oauth-client",
        "oauth-client-secret",
        ["tag:kiln"]
      )
    )

    expect(verified).toEqual({
      clientId: "oauth-client",
      scopes: [...requiredTailscaleOAuthScopes].sort(),
      tags: ["tag:kiln"],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe("https://api.tailscale.com/api/v2/oauth/token")
    const body = new URLSearchParams(String(init?.body))
    expect(body.get("grant_type")).toBe("client_credentials")
    expect(body.get("scope")).toBe(requiredTailscaleOAuthScopes.join(" "))
    expect(body.get("tags")).toBe("tag:kiln")
  })

  it("clears split DNS when a network no longer has deployments", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        if (String(input).endsWith("/oauth/token")) {
          return Response.json({
            access_token: "access-token",
            scope: requiredTailscaleOAuthScopes.join(" "),
          })
        }
        return Response.json({})
      }
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await Effect.runPromise(
      syncTailscaleControlPlaneEffect(
        {
          clientId: "oauth-client",
          clientSecret: "oauth-client-secret",
          scopes: [...requiredTailscaleOAuthScopes],
          tags: ["tag:kiln"],
        },
        {
          deployments: [],
          domain: "test",
          id: "a".repeat(40),
          name: "Test network",
        }
      )
    )

    expect(result).toEqual({ resolvers: [] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe("https://api.tailscale.com/api/v2/tailnet/-/dns/split-dns")
    expect(JSON.parse(String(init?.body))).toEqual({ test: null })
  })
})
