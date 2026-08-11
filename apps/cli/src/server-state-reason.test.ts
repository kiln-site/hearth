import { describe, expect, it } from "vite-plus/test"

import { formatServerStateReason } from "./server-state-reason.js"

describe("server state reasons", () => {
  it("keeps readiness feedback concise", () => {
    expect(formatServerStateReason({ code: "waiting_for_readiness" })).toBe(
      "Waiting for the configured server port to accept connections."
    )
  })

  it("includes process evidence for automatic recovery", () => {
    expect(
      formatServerStateReason({
        code: "automatic_recovery",
        exitCode: 137,
        phase: "restarting",
        reason: "process_exit",
      })
    ).toBe(
      "Automatic recovery is restarting the server after process exit code 137."
    )
  })
})
