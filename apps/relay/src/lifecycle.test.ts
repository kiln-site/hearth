import { describe, expect, it } from "vite-plus/test"
import { relayInstanceWebRoutesSchema } from "@workspace/contracts"

import { loadConfig } from "./config.js"
import {
  coreDnsHostnamePattern,
  LifecycleDriver,
  routeLabelsRequireRestart,
  traefikDynamicConfiguration,
  traefikRouteLabels,
  traefikStaticConfiguration,
  velocityForcedHosts,
} from "./lifecycle.js"

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
    id: "b00d4423-2620-4079-845a-dac8c063987a",
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
    expect(dynamicConfiguration).toContain("http://kiln-aaaaaaaa:8080")
    expect(dynamicConfiguration).toContain("stripPrefix:")
  })

  it("builds direct Ember labels for a Coolify Traefik edge", () => {
    const labels = traefikRouteLabels([route], {
      certificateResolver: "letsencrypt",
      httpEntryPoint: "http",
      httpsEntryPoint: "https",
    })
    const name = "kiln-route-b00d442326204079845adac8c063987a"
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
    expect(labels["kiln.relay.web-routes.revision"]).toMatch(/^[a-f0-9]{64}$/u)
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
