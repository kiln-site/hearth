import { execFile } from "node:child_process"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { request } from "node:http"
import { join } from "node:path"
import { promisify } from "node:util"
import { Effect } from "effect"

import { RelaySystemUpdateError } from "./effect/errors.js"
import {
  replaceContainerEffect,
  type ContainerInspect,
  type ContainerUpdateDocker,
  type ImageInspect,
} from "./update-container.js"

const executeFile = promisify(execFile)
const dockerSocket = "/var/run/docker.sock"

interface UpdateOperation {
  component: "hearth" | "relay"
  error: string | null
  finishedAt: string | null
  id: string
  previousImage: string
  requestedImage: string
  startedAt: string
  status: "failed" | "running" | "succeeded"
  targetContainer: string
  version: string
}

const operationId = requiredEnvironment("KILN_UPDATE_OPERATION_ID")
const operationsDirectory = requiredEnvironment("KILN_UPDATE_DATA_DIR")
const targetContainer = requiredEnvironment("KILN_UPDATE_TARGET_CONTAINER")
const targetImage = requiredEnvironment("KILN_UPDATE_TARGET_IMAGE")
const targetReference = requiredEnvironment("KILN_UPDATE_TARGET_REFERENCE")
const targetVersion = requiredEnvironment("KILN_UPDATE_VERSION")
const operationPath = join(operationsDirectory, `${operationId}.json`)

const dockerRuntime: ContainerUpdateDocker = {
  command: docker,
  createContainer: (name, configuration) =>
    dockerJson(
      `/containers/create?name=${encodeURIComponent(name)}`,
      configuration
    ),
  inspectContainer: inspect,
  inspectImage,
  waitUntilHealthy,
}

const updaterEffect = readOperationEffect().pipe(
  Effect.flatMap((operation) => {
    const backupName = `${targetContainer}-kiln-backup-${Date.now()}`
    return Effect.gen(function* () {
      // Give Relay enough time to return the operation id before a self-update
      // closes its control socket.
      yield* Effect.sleep("1500 millis")
      yield* replaceContainerEffect(
        {
          backupName,
          targetContainer,
          targetImage,
          targetReference,
          targetVersion,
        },
        dockerRuntime
      )
      yield* updateOperationEffect({
        ...operation,
        error: null,
        finishedAt: new Date().toISOString(),
        status: "succeeded",
      })
    }).pipe(
      Effect.catch((cause) =>
        updateOperationEffect({
          ...operation,
          error: cause.message,
          finishedAt: new Date().toISOString(),
          status: "failed",
        }).pipe(
          Effect.andThen(
            Effect.sync(() => {
              process.exitCode = 1
            })
          )
        )
      )
    )
  }),
  Effect.withSpan("relay.updater.run")
)

await Effect.runPromise(updaterEffect)

async function waitUntilHealthy(container: string): Promise<void> {
  const deadline = Date.now() + 120_000
  let runningSince = 0
  while (Date.now() < deadline) {
    const current = await inspect(container)
    if (!current.State.Running) {
      throw new Error("The replacement container exited during startup")
    }
    const health = current.State.Health?.Status
    if (health === "healthy") return
    if (health === "unhealthy") {
      throw new Error("The replacement container failed its health check")
    }
    if (!health) {
      runningSince ||= Date.now()
      if (Date.now() - runningSince >= 5_000) return
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000))
  }
  throw new Error("The replacement container did not become healthy in time")
}

async function inspect(container: string): Promise<ContainerInspect> {
  const result = await docker(["inspect", container])
  const inspected = (JSON.parse(result.stdout) as Array<ContainerInspect>)[0]
  if (!inspected) throw new Error("Docker could not inspect the target")
  return inspected
}

async function inspectImage(image: string): Promise<ImageInspect> {
  const result = await docker(["image", "inspect", image])
  const inspected = (JSON.parse(result.stdout) as Array<ImageInspect>)[0]
  if (!inspected) throw new Error("Docker could not inspect the target image")
  return inspected
}

async function docker(
  arguments_: Array<string>,
  timeout = 60_000
): Promise<{ stderr: string; stdout: string }> {
  const result = await executeFile("docker", arguments_, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout,
  })
  return { stderr: result.stderr, stdout: result.stdout }
}

async function dockerJson(path: string, body: unknown): Promise<void> {
  const encoded = Buffer.from(JSON.stringify(body))
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const dockerRequest = request({
      headers: {
        "Content-Length": String(encoded.byteLength),
        "Content-Type": "application/json",
      },
      method: "POST",
      path,
      socketPath: dockerSocket,
    })
    const chunks: Array<Buffer> = []
    const timer = setTimeout(
      () => dockerRequest.destroy(new Error("Docker API request timed out")),
      60_000
    )
    dockerRequest.on("response", (response) => {
      response.on("data", (chunk: Buffer) => chunks.push(chunk))
      response.on("end", () => {
        clearTimeout(timer)
        const text = Buffer.concat(chunks).toString("utf8")
        if ((response.statusCode ?? 500) >= 400) {
          rejectPromise(
            new Error(
              `Docker API returned HTTP ${response.statusCode ?? 500}: ${text}`
            )
          )
          return
        }
        resolvePromise()
      })
    })
    dockerRequest.on("error", (cause) => {
      clearTimeout(timer)
      rejectPromise(cause)
    })
    dockerRequest.end(encoded)
  })
}

function readOperationEffect() {
  return updaterOperation("readOperation", () =>
    readFile(operationPath, "utf8")
  ).pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: () => JSON.parse(text) as UpdateOperation,
        catch: (cause) =>
          updaterError("decodeOperation", "Invalid update operation", cause),
      })
    )
  )
}

function updateOperationEffect(operation: UpdateOperation) {
  const temporary = `${operationPath}.${process.pid}.tmp`
  return Effect.gen(function* () {
    yield* updaterOperation("createOperationDirectory", () =>
      mkdir(operationsDirectory, { recursive: true, mode: 0o700 })
    )
    yield* updaterOperation("writeOperation", () =>
      writeFile(temporary, `${JSON.stringify(operation, null, 2)}\n`, {
        mode: 0o600,
      })
    )
    yield* updaterOperation("commitOperation", () =>
      rename(temporary, operationPath)
    ).pipe(Effect.uninterruptible)
  }).pipe(
    Effect.uninterruptible,
    Effect.ensuring(
      updaterOperation("cleanupOperation", () =>
        rm(temporary, { force: true })
      ).pipe(
        Effect.asVoid,
        Effect.catch((cause) =>
          Effect.logWarning("System updater operation cleanup failed", cause)
        )
      )
    )
  )
}

function updaterOperation<TResult>(phase: string, run: () => Promise<TResult>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => updaterError(phase, undefined, cause),
  })
}

function updaterError(
  phase: string,
  reason: string | undefined,
  cause: unknown
) {
  return cause instanceof RelaySystemUpdateError
    ? cause
    : RelaySystemUpdateError.make({
        phase: `updater.${phase}`,
        reason:
          reason ??
          (cause instanceof Error ? cause.message : "System update failed"),
        cause,
        rollbackFailures: [],
      })
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
