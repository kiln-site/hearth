import { describe, expect, it } from "vite-plus/test"

import {
  decodeWebRouteRecoveryLabels,
  planWebRouteRecovery,
  webRouteRecoveryLabels,
} from "./web-route-labels.js"

const instanceId = "a".repeat(40)

describe("Relay web route recovery labels", () => {
  it("encodes the compact label format", () => {
    expect(
      webRouteRecoveryLabels([
        {
          hostname: "mc.donutsmp.com",
          id: "b00d4423",
          path: "/map",
          stripPrefix: true,
          targetPort: 8_080,
        },
        {
          hostname: "admin.donutsmp.com",
          id: "decafbad",
          path: "/admin",
          stripPrefix: false,
          targetPort: 3_000,
        },
      ])
    ).toEqual({
      "kiln.relay.web-routes.b00d4423": "mc.donutsmp.com:8080/map",
      "kiln.relay.web-routes.decafbad":
        "admin.donutsmp.com:3000/admin|keep-prefix",
    })
  })

  it("decodes labels and ignores the revision marker", () => {
    const decoded = decodeWebRouteRecoveryLabels({
      "kiln.relay.web-routes.b00d4423": "mc.donutsmp.com:8080/map",
      "kiln.relay.web-routes.decafbad":
        "admin.donutsmp.com:3000/admin|keep-prefix",
      "kiln.relay.web-routes.revision": "abc123",
      "other.label": "ignored",
    })

    expect(decoded.warnings).toEqual([])
    expect(decoded.routes).toEqual([
      {
        hostname: "mc.donutsmp.com",
        id: "b00d4423",
        path: "/map",
        stripPrefix: true,
        targetPort: 8_080,
      },
      {
        hostname: "admin.donutsmp.com",
        id: "decafbad",
        path: "/admin",
        stripPrefix: false,
        targetPort: 3_000,
      },
    ])
  })

  it("keeps persisted routes authoritative", () => {
    const persisted = [
      {
        hostname: "new.example.com",
        id: "cafebabe",
        instanceId,
        path: null,
        stripPrefix: true,
        targetPort: 8_080,
      },
    ]
    const plan = planWebRouteRecovery(persisted, [
      {
        instanceId,
        labels: {
          "kiln.relay.web-routes.b00d4423": "old.example.com:8080",
        },
        service: "kiln-aaaaaaaa",
      },
    ])

    expect(plan).toEqual({ recoveries: [], warnings: [] })
  })

  it("rejects Relay-local collisions while recovering other routes", () => {
    const plan = planWebRouteRecovery(
      [],
      [
        {
          instanceId,
          labels: {
            "kiln.relay.web-routes.b00d4423": "mc.donutsmp.com:8080/map",
          },
          service: "kiln-aaaaaaaa",
        },
        {
          instanceId: "b".repeat(40),
          labels: {
            "kiln.relay.web-routes.b00d4423": "admin.donutsmp.com:3000",
            "kiln.relay.web-routes.decafbad": "mc.donutsmp.com:9000/map",
            "kiln.relay.web-routes.facefeed": "valid.donutsmp.com:9000",
          },
          service: "kiln-bbbbbbbb",
        },
      ]
    )

    expect(plan.recoveries).toHaveLength(2)
    expect(plan.recoveries[1]?.routes).toEqual([
      {
        hostname: "valid.donutsmp.com",
        id: "facefeed",
        path: null,
        stripPrefix: true,
        targetPort: 9_000,
      },
    ])
    expect(plan.warnings).toEqual([
      "kiln-bbbbbbbb: route ID b00d4423 is already used on this Relay",
      "kiln-bbbbbbbb: mc.donutsmp.com/map is already used on this Relay",
    ])
  })

  it("skips malformed labels without blocking Relay startup", () => {
    const decoded = decodeWebRouteRecoveryLabels({
      "kiln.relay.web-routes.not-an-id": "mc.donutsmp.com:8080",
      "kiln.relay.web-routes.b00d4423":
        "mc.donutsmp.com:8080/map|unknown-option",
      "kiln.relay.web-routes.decafbad": "valid.donutsmp.com:9000",
    })

    expect(decoded.routes).toHaveLength(1)
    expect(decoded.warnings).toHaveLength(2)
  })
})
