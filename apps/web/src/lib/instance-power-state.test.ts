import { describe, expect, it } from "vite-plus/test"
import { relayInstanceSchema } from "@workspace/contracts"

import {
  beginPendingPowerAction,
  finishPendingPowerAction,
  initialPendingPowerAction,
  reconcilePendingPowerInstance,
  reconcilePendingPowerState,
} from "./instance-power-state"

describe("pending instance power state", () => {
  it("advances the registered action from its response before a stale stream", () => {
    const relayId = "relay"
    const running = relayInstanceSchema.parse({
      id: "a".repeat(40),
      shortId: "a".repeat(8),
      name: "Power test",
      game: "Minecraft",
      implementation: "Paper",
      version: "1.21.11",
      javaVersion: "21",
      connectAddress: "power.test",
      service: "power-test",
      directory: "/srv/power-test",
      desiredState: "running",
      observedState: "running",
      containerId: "container",
      status: "Running",
    })
    beginPendingPowerAction(relayId, running.id, "stop")

    try {
      const actionResponse = reconcilePendingPowerInstance(relayId, {
        ...running,
        desiredState: "stopped",
        observedState: "stopped",
        status: "Exited (143)",
      })
      const staleStream = reconcilePendingPowerInstance(relayId, running)

      expect(actionResponse.observedState).toBe("stopped")
      expect(staleStream.observedState).toBe("stopped")
    } finally {
      finishPendingPowerAction(relayId, running.id)
    }
  })

  it("latches a completed stop response before stale stream snapshots", () => {
    const stopping = initialPendingPowerAction("stop")
    const actionResponse = reconcilePendingPowerState(stopping, "stopped")
    const staleStream = reconcilePendingPowerState(
      actionResponse.pending,
      "running"
    )

    expect(reconcilePendingPowerState(stopping, "running").observedState).toBe(
      "stopping"
    )
    expect(actionResponse.observedState).toBe("stopped")
    expect(staleStream.observedState).toBe("stopped")
  })

  it("does not let stale snapshots move a start backwards", () => {
    const starting = initialPendingPowerAction("start")
    const running = reconcilePendingPowerState(starting, "running")

    expect(reconcilePendingPowerState(starting, "stopped").observedState).toBe(
      "starting"
    )
    expect(running.observedState).toBe("running")
    expect(
      reconcilePendingPowerState(running.pending, "stopped").observedState
    ).toBe("running")
  })

  it("moves restart snapshots from stopping to starting before running", () => {
    const stopping = initialPendingPowerAction("restart")
    const replacement = reconcilePendingPowerState(stopping, "starting")

    expect(reconcilePendingPowerState(stopping, "running").observedState).toBe(
      "stopping"
    )
    expect(replacement.observedState).toBe("starting")
    expect(
      reconcilePendingPowerState(replacement.pending, "running").observedState
    ).toBe("running")
  })
})
