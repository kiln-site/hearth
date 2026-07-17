import type { Server } from "node:http"

export type RelayShutdownResult = "forced" | "graceful"

export function closeRelayServer(
  server: Server,
  activeStreamControllers: ReadonlySet<AbortController>,
  timeoutMs = 10_000
): Promise<RelayShutdownResult> {
  for (const controller of activeStreamControllers) controller.abort()

  return new Promise((resolve) => {
    let complete = false
    const finish = (result: RelayShutdownResult) => {
      if (complete) return
      complete = true
      clearTimeout(deadline)
      resolve(result)
    }
    const deadline = setTimeout(() => {
      server.closeAllConnections()
      finish("forced")
    }, timeoutMs)
    deadline.unref()

    server.close(() => finish("graceful"))
    server.closeIdleConnections()
  })
}
