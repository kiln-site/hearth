import { assert, describe, it } from "@effect/vitest"

import { normalizedRoute } from "./route-label.js"

describe("normalizedRoute", () => {
  it("normalizes collection and resource routes", () => {
    assert.strictEqual(normalizedRoute("/v1/instances"), "v1.instances")
    assert.strictEqual(
      normalizedRoute("/v1/instances/server-1/console-stream"),
      "v1.instances.console-stream"
    )
  })

  it("normalizes bare instance routes without including the instance id", () => {
    assert.strictEqual(
      normalizedRoute("/v1/instances/server-1"),
      "v1.instances.instance"
    )
  })

  it("labels unmatched routes as unknown", () => {
    assert.strictEqual(normalizedRoute("/not-a-relay-route"), "unknown")
  })
})
