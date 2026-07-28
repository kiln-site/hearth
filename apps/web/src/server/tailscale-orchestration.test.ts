import { describe, expect, it } from "vite-plus/test"

import {
  applyTailscaleDeploymentPlan,
  type DesiredTailscaleDeployment,
  type TailscaleDeploymentState,
} from "./tailscale-orchestration"

interface TestDeployment extends TailscaleDeploymentState {
  revision: string
}

describe("Tailscale deployment orchestration", () => {
  it("applies nodes sequentially and sends the auth key only to new nodes", async () => {
    const calls: Array<{ authKey?: string; relayId: string }> = []
    let active = 0
    let maximumActive = 0
    const current = [deployment("relay-a", "old")]

    const result = await applyTailscaleDeploymentPlan({
      authKey: "test-auth-key",
      current,
      desired: [target("relay-a"), target("relay-b")],
      domain: "test",
      id: "a".repeat(40),
      name: "Test network",
      operations: {
        apply: async (desired, input) => {
          active += 1
          maximumActive = Math.max(maximumActive, active)
          await Promise.resolve()
          calls.push({ authKey: input.authKey, relayId: desired.relayId })
          active -= 1
          return deployment(desired.relayId, "applied")
        },
        remove: async () => undefined,
        syncDns: async (value) => value,
      },
    })

    expect(maximumActive).toBe(1)
    expect(calls).toEqual([
      { authKey: undefined, relayId: "relay-a" },
      { authKey: "test-auth-key", relayId: "relay-b" },
    ])
    expect(result.map(({ relayId }) => relayId)).toEqual(["relay-a", "relay-b"])
  })

  it("restores changed nodes when a later node apply fails", async () => {
    const applyRevisions: Array<string> = []
    const synchronized: Array<string> = []
    const current = [deployment("relay-a", "old")]

    await expect(
      applyTailscaleDeploymentPlan({
        authKey: "test-auth-key",
        current,
        desired: [target("relay-a"), target("relay-b")],
        domain: "test",
        id: "a".repeat(40),
        name: "Test network",
        operations: {
          apply: async (desired, input) => {
            if (desired.relayId === "relay-b") throw new Error("join failed")
            const revision =
              input.bindings[0]?.hostname === "old" ? "restored" : "changed"
            applyRevisions.push(revision)
            return deployment(desired.relayId, revision)
          },
          remove: async () => undefined,
          syncDns: async (value) => {
            synchronized.push(value.relayId)
            return value
          },
        },
      })
    ).rejects.toThrow("join failed")

    expect(applyRevisions).toEqual(["changed", "restored"])
    expect(synchronized).toEqual(["relay-a"])
  })

  it("removes a newly installed node when a later apply fails", async () => {
    const removed: Array<string> = []

    await expect(
      applyTailscaleDeploymentPlan({
        authKey: "test-auth-key",
        current: [],
        desired: [target("relay-a"), target("relay-b")],
        domain: "test",
        id: "a".repeat(40),
        name: "Test network",
        operations: {
          apply: async (desired) => {
            if (desired.relayId === "relay-b") throw new Error("join failed")
            return deployment(desired.relayId, "installed")
          },
          remove: async (value) => {
            removed.push(value.relayId)
          },
          syncDns: async (value) => value,
        },
      })
    ).rejects.toThrow("join failed")

    expect(removed).toEqual(["relay-a"])
  })

  it("restores every node after a DNS synchronization failure", async () => {
    const restored: Array<string> = []
    const current = [deployment("relay-a", "old"), deployment("relay-b", "old")]

    await expect(
      applyTailscaleDeploymentPlan({
        current,
        desired: [target("relay-a"), target("relay-b")],
        domain: "test",
        id: "a".repeat(40),
        name: "Test network",
        operations: {
          apply: async (desired, input) => {
            if (input.bindings[0]?.hostname === "old") {
              restored.push(desired.relayId)
              return deployment(desired.relayId, "old")
            }
            return deployment(desired.relayId, "changed")
          },
          remove: async () => undefined,
          syncDns: async (value) => {
            if (value.revision === "changed" && value.relayId === "relay-b") {
              throw new Error("DNS failed")
            }
            return value
          },
        },
      })
    ).rejects.toThrow("DNS failed")

    expect(restored.sort()).toEqual(["relay-a", "relay-b"])
  })
})

function target(relayId: string): DesiredTailscaleDeployment {
  return {
    bindings: [{ hostname: `new-${relayId}`, instanceId: relayId }],
    hostname: `network-${relayId}`,
    relayId,
    relayName: relayId,
  }
}

function deployment(relayId: string, revision: string): TestDeployment {
  return {
    bindings: [
      {
        address: "10.165.55.10",
        hostname: revision === "old" ? "old" : `new-${relayId}`,
        instanceId: relayId,
      },
    ],
    domain: "test",
    hostname: `network-${relayId}`,
    id: "a".repeat(40),
    name: "Test network",
    relayId,
    relayName: relayId,
    revision,
  }
}
