import type {
  RelayConsoleLine,
  RelayConsoleStreamEvent,
} from "@workspace/contracts"
import { describe, expect, it } from "vite-plus/test"

import { prepareFollowLogOutput } from "./logs.js"

describe("followed CLI logs", () => {
  it("prints a limited chronological snapshot before unseen live lines", () => {
    const oldest = line("oldest", "Oldest", "2026-08-09T12:00:00.000Z")
    const recent = line("recent", "Recent", "2026-08-09T12:01:00.000Z")
    const newest = line("newest", "Newest", "2026-08-09T12:02:00.000Z")
    const live = line("live", "Live", "2026-08-09T12:03:00.000Z")
    const output = prepareFollowLogOutput([oldest, recent, newest], 2)
    const streamEvents: Array<RelayConsoleStreamEvent> = [
      {
        instanceId: "instance",
        lines: [recent, newest],
        startedAt: "2026-08-09T12:00:00.000Z",
        truncated: true,
        type: "reset",
      },
      {
        instanceId: "instance",
        startedAt: "2026-08-09T12:00:00.000Z",
        type: "ready",
      },
      {
        instanceId: "instance",
        lines: [oldest],
        startedAt: "2026-08-09T12:00:00.000Z",
        truncated: false,
        type: "history",
      },
      { line: newest, type: "line" },
      { line: live, type: "line" },
    ]

    expect(output.initialLines.map((entry) => entry.text)).toEqual([
      "Recent",
      "Newest",
    ])
    expect(
      streamEvents
        .map(output.liveLine)
        .filter((entry) => entry !== undefined)
        .map((entry) => entry.text)
    ).toEqual(["Live"])
  })
})

function line(id: string, text: string, timestamp: string): RelayConsoleLine {
  return { id, level: "info", text, timestamp }
}
