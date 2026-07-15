import { createServer } from "node:http"

import {
  relayConsoleCommandSchema,
  relayConsoleCompletionInputSchema,
  relayCreateInstanceSchema,
  relayInstanceActionSchema,
  relayNetworkingSchema,
  relaySaveFileInputSchema,
} from "@workspace/contracts"

import { BRICKS } from "./bricks.js"
import { loadConfig } from "./config.js"
import { DockerDriver } from "./docker.js"
import { FilesystemDriver, RelayFilesystemError } from "./files.js"
import { LifecycleDriver } from "./lifecycle.js"
import { nodeSnapshot } from "./node.js"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { RelayConfig } from "./config.js"

const config = loadConfig()
const docker = new DockerDriver(config)
const filesystem = new FilesystemDriver(config)
const lifecycle = new LifecycleDriver(config, docker)
const activeConsoleStreams = new Map<string, number>()
const MAX_CONSOLE_STREAMS_PER_INSTANCE = 6

const server = createServer(async (request, response) => {
  try {
    if (!authorize(request, response, config)) return
    await route(request, response)
  } catch (error) {
    if (error instanceof RelayFilesystemError) {
      json(response, 400, { error: error.message, code: error.code })
      return
    }
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error(error)
    json(response, 500, { error: message, code: "internal_error" })
  }
})

server.listen(config.port, config.host, () => {
  console.log(
    `Relay ${config.nodeId} listening on http://${config.host}:${config.port}`
  )
  console.log(
    `Discovering ${config.managedLabel} containers in ${config.rootDirectory}`
  )
})

async function route(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`)
  const method = request.method ?? "GET"

  if (method === "GET" && url.pathname === "/health") {
    response.writeHead(204).end()
    return
  }

  if (method === "GET" && url.pathname === "/v1/snapshot") {
    const [node, instances] = await Promise.all([
      nodeSnapshot(config, docker),
      docker.inspectInstances(),
    ])
    json(response, 200, { node, instances })
    return
  }

  if (method === "GET" && url.pathname === "/v1/bricks") {
    json(response, 200, { bricks: BRICKS })
    return
  }

  if (url.pathname === "/v1/networking") {
    if (method === "GET") {
      json(response, 200, (await lifecycle.networking()) ?? null)
      return
    }
    if (method === "PUT") {
      const input = relayNetworkingSchema.parse(await readJson(request))
      json(response, 200, await lifecycle.configureNetworking(input))
      return
    }
  }

  if (method === "POST" && url.pathname === "/v1/instances") {
    const input = relayCreateInstanceSchema.parse(await readJson(request))
    json(response, 201, await lifecycle.createInstance(input))
    return
  }

  const instanceRoot = url.pathname.match(/^\/v1\/instances\/([^/]+)$/u)
  if (instanceRoot && method === "DELETE") {
    await lifecycle.deleteInstance(
      decodeURIComponent(instanceRoot[1]),
      url.searchParams.get("deleteData") === "true"
    )
    response.writeHead(204).end()
    return
  }

  const match = url.pathname.match(
    /^\/v1\/instances\/([^/]+)\/(tree|file|actions|console|console-completions|console-stream|latest-log)$/u
  )
  if (!match) {
    json(response, 404, { error: "Route not found", code: "not_found" })
    return
  }

  const id = decodeURIComponent(match[1])
  const instance = await docker.findInstance(id)
  if (!instance) {
    json(response, 404, { error: "Instance not found", code: "not_found" })
    return
  }

  const resource = match[2]
  if (method === "GET" && resource === "tree") {
    json(response, 200, await filesystem.tree(instance))
    return
  }

  if (resource === "file") {
    const path = url.searchParams.get("path") ?? ""
    if (method === "GET") {
      json(response, 200, await filesystem.read(instance, path))
      return
    }
    if (method === "PUT") {
      const input = relaySaveFileInputSchema.parse(await readJson(request))
      json(response, 200, await filesystem.write(instance, path, input))
      return
    }
  }

  if (method === "POST" && resource === "actions") {
    const input = relayInstanceActionSchema.parse(await readJson(request))
    json(response, 202, await docker.runAction(instance, input.action))
    return
  }

  if (resource === "console") {
    if (method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? 2_000)
      json(response, 200, await docker.console(instance, limit))
      return
    }
    if (method === "POST") {
      const input = relayConsoleCommandSchema.parse(await readJson(request))
      await docker.sendCommand(instance, input.command)
      json(response, 202, { accepted: true, command: input.command })
      return
    }
  }

  if (method === "POST" && resource === "console-completions") {
    const input = relayConsoleCompletionInputSchema.parse(
      await readJson(request)
    )
    json(
      response,
      200,
      await docker.completeCommand(instance, input.input, input.cursor)
    )
    return
  }

  if (method === "GET" && resource === "console-stream") {
    const activeStreams = activeConsoleStreams.get(instance.id) ?? 0
    if (activeStreams >= MAX_CONSOLE_STREAMS_PER_INSTANCE) {
      json(response, 429, {
        error: "Too many active console streams for this instance",
        code: "too_many_console_streams",
      })
      return
    }
    activeConsoleStreams.set(instance.id, activeStreams + 1)
    const controller = new AbortController()
    const close = () => controller.abort()
    response.once("close", close)
    response.once("error", close)
    response.writeHead(200, {
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no",
    })
    response.flushHeaders()
    let heartbeat: ReturnType<typeof setInterval> | null = null
    try {
      const ready = `${JSON.stringify({ type: "ready", instanceId: instance.id })}\n`
      if (!(await writeStreamChunk(response, ready, controller.signal))) return
      heartbeat = setInterval(() => {
        if (!response.destroyed && !response.writableEnded) response.write("\n")
      }, 15_000)
      for await (const line of docker.streamConsole(
        instance,
        controller.signal
      )) {
        const chunk = `${JSON.stringify({ type: "line", line })}\n`
        if (!(await writeStreamChunk(response, chunk, controller.signal))) break
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error(`Console stream for ${instance.id} failed`, error)
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat)
      response.off("close", close)
      response.off("error", close)
      const remaining = (activeConsoleStreams.get(instance.id) ?? 1) - 1
      if (remaining > 0) activeConsoleStreams.set(instance.id, remaining)
      else activeConsoleStreams.delete(instance.id)
      if (!response.destroyed && !response.writableEnded) response.end()
    }
    return
  }

  if (method === "GET" && resource === "latest-log") {
    json(response, 200, await filesystem.latestLog(instance))
    return
  }

  json(response, 405, {
    error: "Method not allowed",
    code: "method_not_allowed",
  })
}

function authorize(
  request: IncomingMessage,
  response: ServerResponse,
  relayConfig: RelayConfig
): boolean {
  if (!relayConfig.token) return true
  if (request.headers.authorization === `Bearer ${relayConfig.token}`)
    return true
  json(response, 401, { error: "Unauthorized", code: "unauthorized" })
  return false
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Array<Buffer> = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > 2 * 1024 * 1024) throw new Error("Request body is too large")
    chunks.push(buffer)
  }
  const body = Buffer.concat(chunks).toString("utf8")
  return body ? (JSON.parse(body) as unknown) : {}
}

function json(response: ServerResponse, status: number, value: unknown): void {
  if (response.destroyed || response.writableEnded) return
  if (response.headersSent) {
    response.destroy()
    return
  }
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  })
  response.end(JSON.stringify(value))
}

function writeStreamChunk(
  response: ServerResponse,
  chunk: string,
  signal: AbortSignal
): Promise<boolean> {
  if (signal.aborted || response.destroyed || response.writableEnded) {
    return Promise.resolve(false)
  }
  if (response.write(chunk)) return Promise.resolve(true)

  return new Promise((resolvePromise) => {
    const cleanup = () => {
      response.off("drain", drained)
      response.off("close", closed)
      response.off("error", closed)
      signal.removeEventListener("abort", closed)
    }
    const drained = () => {
      cleanup()
      resolvePromise(true)
    }
    const closed = () => {
      cleanup()
      resolvePromise(false)
    }

    response.once("drain", drained)
    response.once("close", closed)
    response.once("error", closed)
    signal.addEventListener("abort", closed, { once: true })
  })
}
