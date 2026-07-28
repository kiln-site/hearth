import { describe, expect, it } from "vite-plus/test"

import {
  initialPendingPowerAction,
  reconcilePendingPowerState,
} from "./instance-power-state"

describe("pending instance power state", () => {
  it("does not let stale snapshots move a stop backwards", () => {
    const stopping = initialPendingPowerAction("stop")
    const stopped = reconcilePendingPowerState(stopping, "stopped")

    expect(reconcilePendingPowerState(stopping, "running").observedState).toBe(
      "stopping"
    )
    expect(stopped.observedState).toBe("stopped")
    expect(
      reconcilePendingPowerState(stopped.pending, "running").observedState
    ).toBe("stopped")
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
