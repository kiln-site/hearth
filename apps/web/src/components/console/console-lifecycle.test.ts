import { describe, expect, it } from "vite-plus/test"

import {
  initialConsoleStateLines,
  isConsoleStateLine,
  shouldRecordConsoleStateTransition,
} from "./console-lifecycle"

const startedAt = "2026-07-28T19:57:00.000Z"

describe("console lifecycle lines", () => {
  it("shows starting and running for a ready server", () => {
    expect(
      initialConsoleStateLines(startedAt, "running").map((line) => line.text)
    ).toEqual(["Server is starting", "Server is running"])
  })

  it("does not invent a running transition while the server is stopping", () => {
    expect(
      initialConsoleStateLines(startedAt, "stopping").map((line) => line.text)
    ).toEqual(["Server is starting", "Server is stopping"])
  })

  it("identifies synthetic lifecycle lines for centered rendering", () => {
    const [line] = initialConsoleStateLines(null, "stopped")

    expect(line?.text).toBe("Server stopped")
    expect(line && isConsoleStateLine(line)).toBe(true)
    expect(isConsoleStateLine({ id: "docker:log-line" })).toBe(false)
  })

  it("ignores stale states that move a stopping lifecycle backwards", () => {
    expect(shouldRecordConsoleStateTransition("stopped", "stopping")).toBe(
      false
    )
    expect(shouldRecordConsoleStateTransition("stopping", "stopped")).toBe(true)
    expect(shouldRecordConsoleStateTransition("stopping", "starting")).toBe(
      true
    )
  })
})
