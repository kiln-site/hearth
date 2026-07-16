import { fileURLToPath } from "node:url"

import { serve } from "srvx/node"
import { log } from "srvx/log"
import { serveStatic } from "srvx/static"

const HEALTH_PATH = "/api/health"
const app = (await import("../dist/server/server.js")).default
const logRequest = log()

if (!app || typeof app.fetch !== "function") {
  throw new Error("Kiln's production server handler could not be loaded")
}

const server = serve({
  ...app,
  error(error) {
    console.error(error)
    return new Response(
      "<!doctype html><html><head><title>Server Error</title></head><body><h1>Server Error</h1><p>Something went wrong while processing your request.</p></body></html>",
      {
        headers: { "Content-Type": "text/html; charset=utf-8" },
        status: 500,
      }
    )
  },
  gracefulShutdown: true,
  hostname: process.env.HOST || "0.0.0.0",
  middleware: [
    logUnlessSuccessfulHealthCheck,
    serveStatic({
      dir: fileURLToPath(new URL("../dist/client", import.meta.url)),
    }),
    ...(app.middleware ?? []),
  ],
  port: process.env.PORT || 3000,
})

await server.ready()

async function logUnlessSuccessfulHealthCheck(request, next) {
  if (new URL(request.url).pathname !== HEALTH_PATH) {
    return logRequest(request, next)
  }

  const startedAt = performance.now()
  const response = await next()
  if (!response.ok) {
    const duration = (performance.now() - startedAt).toFixed(2)
    console.error(
      `[${new Date().toLocaleTimeString()}] ${request.method} ${request.url} [${response.status}] (${duration}ms)`
    )
  }
  return response
}
