import { describe, expect, it } from "vite-plus/test"

import {
  dockerLogSinceArguments,
  matchingReadyLogLine,
  observedSessionReadyAt,
  parseConsoleLine,
} from "./docker.js"

describe("Docker console parsing", () => {
  it("limits every log target to its current container session", () => {
    expect(dockerLogSinceArguments("2026-07-25T17:59:03.000000000Z")).toEqual([
      "--since",
      "2026-07-25T17:59:03.000000000Z",
    ])
    expect(dockerLogSinceArguments("0001-01-01T00:00:00Z")).toEqual([])
  })

  it("retains safe ANSI styling while keeping searchable plain text", () => {
    expect(
      parseConsoleLine(
        "2026-07-25T17:59:03.000000000Z \u001b[92mBukkit Plugins:\u001b[0m \u001b[96mLuckPerms\u001b[0m"
      )
    ).toEqual({
      level: "info",
      segments: [
        { text: "Bukkit Plugins:", color: "#4ade80" },
        { text: " " },
        { text: "LuckPerms", color: "#22d3ee" },
      ],
      text: "Bukkit Plugins: LuckPerms",
      timestamp: "2026-07-25T17:59:03.000000000Z",
    })
  })

  it("parses raw Minecraft section formatting into plain text and segments", () => {
    expect(
      parseConsoleLine("2026-07-25T17:59:03.000000000Z §aGreen §lBold §rPlain")
    ).toEqual({
      level: "info",
      segments: [
        { text: "Green ", color: "#55ff55" },
        { text: "Bold ", color: "#55ff55", bold: true },
        { text: "Plain" },
      ],
      text: "Green Bold Plain",
      timestamp: "2026-07-25T17:59:03.000000000Z",
    })
  })

  it("finds the first literal startup completion log after formatting", () => {
    const lines = [
      parseConsoleLine(
        "2026-07-25T17:59:03.000000000Z \u001b[33mPreparing level world\u001b[0m"
      ),
      parseConsoleLine(
        '2026-07-25T17:59:12.000000000Z \u001b[32mDone (9.0s)! For help, type "help"\u001b[0m'
      ),
    ].filter((line) => line !== null)

    expect(matchingReadyLogLine(lines, [")! For help, type "])?.timestamp).toBe(
      "2026-07-25T17:59:12.000000000Z"
    )
  })

  it("restores a rediscovered running session at its container start", () => {
    const startedAt = "2026-07-25T17:59:03.000000000Z"
    const relayRestartedAt = Date.parse("2026-07-25T20:00:00.000Z")

    expect(
      observedSessionReadyAt(undefined, startedAt, false, relayRestartedAt)
    ).toBe(startedAt)
    expect(
      observedSessionReadyAt(
        "2026-07-25T17:59:12.000000000Z",
        startedAt,
        false,
        relayRestartedAt
      )
    ).toBe("2026-07-25T17:59:12.000000000Z")
    expect(
      observedSessionReadyAt(undefined, startedAt, true, relayRestartedAt)
    ).toBe("2026-07-25T20:00:00.000Z")
  })

  it.each([
    "% Total    % Received % Xferd  Average Speed   Time    Time     Time  Current",
    "0     0    0     0    0     0      0      0 --:--:-- --:--:-- --:--:--     0",
    "100  177k    0  177k    0     0   170k      0 --:--:--  0:00:01 --:--:--  170k",
  ])("removes curl progress output: %s", (line) => {
    expect(
      parseConsoleLine(`2026-07-25T17:59:03.000000000Z ${line}`)
    ).toBeNull()
  })
})
