import { describe, expect, it } from "vite-plus/test"

import { createSocketInbox } from "./relay-console-stream"

describe("Relay console socket inbox", () => {
  it("retains a terminal error after queued messages are consumed", async () => {
    const socket = new FakeWebSocket()
    const inbox = createSocketInbox(
      socket as unknown as WebSocket,
      new AbortController().signal
    )

    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "console.line" }),
      })
    )
    const close = new Event("close")
    Object.assign(close, { code: 1006, reason: "Relay disconnected" })
    socket.dispatchEvent(close)

    await expect(inbox.next()).resolves.toEqual({ type: "console.line" })
    await expect(inbox.next()).rejects.toThrow("Relay disconnected")
    inbox.close()
  })
})

class FakeWebSocket extends EventTarget {
  close(): void {}
}
