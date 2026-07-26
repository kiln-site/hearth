import { describe, expect, it } from "vite-plus/test"
import { relayInstanceWebRoutesSchema } from "@workspace/contracts"

import { loadConfig } from "./config.js"
import {
  coreDnsHostnamePattern,
  discoverExternalTraefikContainer,
  LifecycleDriver,
  recoveryRouteLabels,
  routeLabelsRequireRestart,
  traefikDynamicConfiguration,
  traefikRouteLabels,
  traefikStaticConfiguration,
  velocityForcedHosts,
} from "./lifecycle.js"

describe("external Traefik discovery", () => {
  it.each(["none", "hearth", "traefik"] as const)(
    "only inspects proxies attached to a namespaced edge in %s mode",
    async (mode) => {
      const calls: Array<Array<string>> = []
      const discovered = await discoverExternalTraefikContainer(
        {
          edgeNetwork: "hearth-feature-a1b2c3-kiln-edge",
          resourceNamespace: "hearth-feature-a1b2c3",
          settings: {
            acmeEmail: null,
            mode,
            traefikImage: "traefik:v3.6.6",
          },
        },
        async (_executable, arguments_) => {
          calls.push(arguments_)
          if (arguments_[0] === "network") {
            return {
              stderr: "",
              stdout: "hearth-feature-a1b2c3-kiln-aaaaaaaa\nmanual-traefik\n",
            }
          }
          const name = arguments_.at(-1)
          return {
            stderr: "",
            stdout:
              name === "manual-traefik"
                ? "true traefik:v3.6.6\n"
                : "true ghcr.io/kiln-site/ember:latest\n",
          }
        }
      )

      expect(discovered).toBe("manual-traefik")
      expect(calls.some((arguments_) => arguments_[0] === "ps")).toBe(false)
    }
  )

  it("preserves host proxy discovery for unscoped Relays", async () => {
    const calls: Array<Array<string>> = []
    const discovered = await discoverExternalTraefikContainer(
      {
        edgeNetwork: "kiln-edge",
        resourceNamespace: null,
        settings: {
          acmeEmail: null,
          mode: "none",
          traefikImage: "traefik:v3.6.6",
        },
      },
      async (_executable, arguments_) => {
        calls.push(arguments_)
        if (arguments_[0] === "ps") {
          return {
            stderr: "",
            stdout: arguments_.includes("publish=443") ? "host-traefik\n" : "",
          }
        }
        return {
          stderr: "",
          stdout:
            arguments_.at(-1) === "host-traefik" ? "true traefik:v3.6.6\n" : "",
        }
      }
    )

    expect(discovered).toBe("host-traefik")
    expect(calls.some((arguments_) => arguments_[0] === "network")).toBe(false)
  })
})

describe("CoreDNS Brick hostnames", () => {
  it("matches only deployed hostnames and implementation aliases", () => {
    const expression = coreDnsHostnamePattern("kiln.test", [
      "1.21.11.paper.kiln.test",
      "paper.kiln.test",
      "palworld.kiln.test:8211",
      "outside.example",
    ])
    const pattern = new RegExp(expression.replace(/^\(\?i\)/u, ""), "iu")

    expect(pattern.test("1.21.11.paper.kiln.test.")).toBe(true)
    expect(pattern.test("PAPER.KILN.TEST.")).toBe(true)
    expect(pattern.test("palworld.kiln.test.")).toBe(false)
    expect(pattern.test("kiln.test.")).toBe(false)
    expect(pattern.test("typo.kiln.test.")).toBe(false)
    expect(pattern.test("outside.example.")).toBe(false)
  })

  it("matches nothing before the first Brick is deployed", () => {
    const pattern = new RegExp(coreDnsHostnamePattern("kiln.test", []), "u")
    expect(pattern.test("kiln.test.")).toBe(false)
    expect(pattern.test("anything.kiln.test.")).toBe(false)
  })
})

describe("Velocity forced hosts", () => {
  it("coalesces the default Brick hostname with its implementation alias", () => {
    const forcedHosts = velocityForcedHosts("kiln.test", [
      {
        hostname: "paper.kiln.test",
        implementation: "paper",
        name: "kiln-paper-one",
        target: "kiln-paper-one:25565",
        version: "1.21.11",
      },
      {
        hostname: "paper.kiln.test",
        implementation: "paper",
        name: "kiln-paper-two",
        target: "kiln-paper-two:25565",
        version: "1.21.10",
      },
    ])

    expect(forcedHosts).toBe(
      '"paper.kiln.test" = ["kiln-paper-one", "kiln-paper-two", "limbo"]'
    )
    expect(forcedHosts.match(/"paper[.]kiln[.]test"/gu)).toHaveLength(1)
  })

  it("keeps a version hostname separate from its implementation alias", () => {
    const forcedHosts = velocityForcedHosts("kiln.test", [
      {
        hostname: "1.21.11.paper.kiln.test",
        implementation: "paper",
        name: "kiln-paper-one",
        target: "kiln-paper-one:25565",
        version: "1.21.11",
      },
    ])

    expect(forcedHosts).toContain(
      '"1.21.11.paper.kiln.test" = ["kiln-paper-one", "limbo"]'
    )
    expect(forcedHosts).toContain(
      '"paper.kiln.test" = ["kiln-paper-one", "limbo"]'
    )
  })
})

describe("Traefik web routes", () => {
  const settings = {
    acmeEmail: "admin@example.com",
    mode: "traefik" as const,
    traefikImage: "traefik:v3.6.6",
  }
  const route = {
    hostname: "donutsmp.example.com",
    id: "b00d4423",
    instanceId: "a".repeat(40),
    path: "/map",
    stripPrefix: true,
    targetPort: 8080,
  }

  it("configures ACME and applies routes without a Docker provider", () => {
    const staticConfiguration = traefikStaticConfiguration(settings)
    const dynamicConfiguration = traefikDynamicConfiguration(
      loadConfig({
        KILN_RELAY_HOST: "relay.example.com",
        KILN_RELAY_PROXY: "traefik",
        NODE_ENV: "development",
      }),
      [route],
      settings
    )

    expect(staticConfiguration).toContain("httpChallenge:")
    expect(staticConfiguration).toContain("admin@example.com")
    expect(staticConfiguration).not.toContain("docker.sock")
    expect(dynamicConfiguration).toContain("PathPrefix(`/map`)")
    expect(dynamicConfiguration).toContain("http://kiln-relay:4100")
    expect(dynamicConfiguration).toContain("http://kiln-aaaaaaaa:8080")
    expect(dynamicConfiguration).not.toContain("rootCAs:")
    expect(dynamicConfiguration).toContain("stripPrefix:")
  })

  it("uses namespaced Ember targets for an isolated Relay", () => {
    const dynamicConfiguration = traefikDynamicConfiguration(
      loadConfig({
        KILN_RELAY_HOST: "relay.example.com",
        KILN_RELAY_PROXY: "traefik",
        KILN_RELAY_RESOURCE_NAMESPACE: "hearth-feature-a1b2c3",
        NODE_ENV: "development",
      }),
      [route],
      settings
    )

    expect(dynamicConfiguration).toContain(
      "http://hearth-feature-a1b2c3-kiln-aaaaaaaa:8080"
    )
  })

  it("builds direct Ember labels for a Coolify Traefik edge", () => {
    const labels = traefikRouteLabels([route], {
      certificateResolver: "letsencrypt",
      httpEntryPoint: "http",
      httpsEntryPoint: "https",
    })
    const name = "kiln-route-b00d4423"
    expect(labels["traefik.enable"]).toBe("true")
    expect(labels["traefik.docker.network"]).toBe("kiln-edge")
    expect(labels[`traefik.http.routers.${name}-https.entrypoints`]).toBe(
      "https"
    )
    expect(labels[`traefik.http.routers.${name}-https.tls.certresolver`]).toBe(
      "letsencrypt"
    )
    expect(
      labels[`traefik.http.services.${name}.loadbalancer.server.port`]
    ).toBe("8080")
    expect(labels["kiln.relay.web-routes.b00d4423"]).toBe(
      "donutsmp.example.com:8080/map"
    )
    expect(labels["kiln.relay.web-routes.revision"]).toMatch(/^[a-f0-9]{64}$/u)
  })

  it("stores recovery labels without exposing the Ember to Traefik", () => {
    const labels = recoveryRouteLabels([route])

    expect(labels["traefik.enable"]).toBe("false")
    expect(labels["traefik.docker.network"]).toBeUndefined()
    expect(labels["kiln.relay.web-routes.b00d4423"]).toBe(
      "donutsmp.example.com:8080/map"
    )
    expect(labels["kiln.relay.web-routes.revision"]).toMatch(/^[a-f0-9]{64}$/u)
  })

  it("hydrates the trusted Coolify edge without advertising private port 4100", () => {
    const config = loadConfig({
      KILN_RELAY_PROXY: "coolify",
      SERVICE_URL_KILN_RELAY_4100: "https://relay.example.com",
      NODE_ENV: "production",
    })
    const lifecycle = new LifecycleDriver(config, null as never, null as never)

    lifecycle.hydrateProxySettings({ ...settings, mode: "coolify" })

    expect(config.publicPort).toBe(443)
    expect(config.browserOrigin).toBe("https://relay.example.com")
  })

  it("does not recreate an untouched Ember with no routes", () => {
    const profile = {
      certificateResolver: "letsencrypt",
      httpEntryPoint: "http",
      httpsEntryPoint: "https",
    }
    const desired = traefikRouteLabels([], profile)
    expect(
      routeLabelsRequireRestart({ "traefik.enable": "false" }, [], desired)
    ).toBe(false)
    expect(
      routeLabelsRequireRestart(
        traefikRouteLabels([route], profile),
        [],
        desired
      )
    ).toBe(true)
  })

  it("rejects paths that can escape a Traefik rule literal", () => {
    expect(() =>
      relayInstanceWebRoutesSchema.parse([
        {
          ...route,
          path: "/map`) || Host(`relay.example.com`)",
        },
      ])
    ).toThrow("routing metacharacters")
  })

  it.each(["/.", "/..", "/map/.", "/map/.."])(
    "rejects terminal dot-segment path %s",
    (path) => {
      expect(() =>
        relayInstanceWebRoutesSchema.parse([{ ...route, path }])
      ).toThrow()
    }
  )

  it("restores the direct endpoint when bundled Traefik is disabled", () => {
    const config = loadConfig({
      KILN_RELAY_HOST: "relay.example.com",
      KILN_RELAY_PROXY: "traefik",
      NODE_ENV: "development",
    })
    const lifecycle = new LifecycleDriver(config, null as never, null as never)

    lifecycle.hydrateProxySettings({ ...settings, mode: "none" })
    expect(config.publicPort).toBe(4100)
    expect(config.browserOrigin).toBe("http://relay.example.com:4100")

    lifecycle.hydrateProxySettings(settings)
    expect(config.publicPort).toBe(443)
    expect(config.browserOrigin).toBe("https://relay.example.com")
  })
})
