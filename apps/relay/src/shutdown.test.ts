import { createServer, get } from "node:http"
import { assert, describe, it } from "@effect/vitest"

import { closeRelayServer } from "./shutdown.js"

describe("closeRelayServer", () => {
  it("closes gracefully when there are no active connections", async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))

    const result = await closeRelayServer(server, new Set(), 100)

    assert.strictEqual(result, "graceful")
  })

  it("aborts streams and enforces the shutdown deadline", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" })
      response.write("data: open\n\n")
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    assert.ok(address && typeof address !== "string")

    let markResponseReady: () => void = () => {}
    const responseReady = new Promise<void>((resolve) => {
      markResponseReady = resolve
    })
    const request = get(`http://127.0.0.1:${address.port}`, (response) => {
      response.once("data", markResponseReady)
    })
    request.on("error", () => undefined)
    await responseReady

    const controller = new AbortController()
    const result = await closeRelayServer(server, new Set([controller]), 25)

    assert.isTrue(controller.signal.aborted)
    assert.strictEqual(result, "forced")
    request.destroy()
  })
})
