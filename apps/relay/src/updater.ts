import { execFile } from "node:child_process"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { request } from "node:http"
import { join } from "node:path"
import { promisify } from "node:util"
import { Effect, Schedule } from "effect"

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
  batchId?: string
  component: "hearth" | "relay"
  error: string | null
  finishedAt: string | null
  id: string
  previousImage: string
  requestedImage: string
  startedAt: string
  status: "failed" | "running" | "succeeded"
  targetContainer: string
  targetReference?: string
  version: string
}

interface UpdateBatch {
  id: string
  operationIds: Array<string>
}

const operationsDirectory = requiredEnvironment("KILN_UPDATE_DATA_DIR")
const batchId = optionalEnvironment("KILN_UPDATE_BATCH_ID")

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

const runOperationEffect = Effect.fn("relay.updater.replace")(function* (
  operation: UpdateOperation,
  legacyReference?: string
) {
  const targetReference = operation.targetReference ?? legacyReference
  if (!targetReference) {
    return yield* Effect.fail(
      updaterError(
        "validateOperation",
        "The update target reference is missing",
        operation
      )
    )
  }
  const backupName = `${operation.targetContainer}-kiln-backup-${Date.now()}`
  yield* replaceContainerEffect(
    {
      backupName,
      targetContainer: operation.targetContainer,
      targetImage: operation.requestedImage,
      targetReference,
      targetVersion: operation.version,
    },
    dockerRuntime
  ).pipe(
    Effect.retry({
      schedule: Schedule.exponential("1 second"),
      times: 2,
    })
  )
  yield* updateOperationEffect({
    ...operation,
    error: null,
    finishedAt: new Date().toISOString(),
    status: "succeeded",
  })
})

const runRecordedOperationEffect = Effect.fn(
  "relay.updater.runRecordedOperation"
)(function* (operation: UpdateOperation, legacyReference?: string) {
  yield* runOperationEffect(operation, legacyReference).pipe(
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
})

const runBatchEffect = Effect.fn("relay.updater.runBatch")(function* (
  activeBatchId: string
) {
  // Return the operation ids before replacing Relay and keep a short idle
  // window so another Hearth request can join this sidecar's queue.
  yield* Effect.sleep("1500 millis")
  let idleChecks = 0
  while (idleChecks < 2) {
    const batch = yield* readBatchEffect(activeBatchId)
    const operations = yield* Effect.forEach(batch.operationIds, (id) =>
      readOperationEffect(id)
    )
    const pending = operations
      .filter((operation) => operation.status === "running")
      .sort((left, right) =>
        left.component === right.component
          ? 0
          : left.component === "hearth"
            ? -1
            : 1
      )
    if (pending.length === 0) {
      idleChecks += 1
      yield* Effect.sleep("2500 millis")
      continue
    }
    idleChecks = 0
    yield* Effect.forEach(
      pending,
      (operation) => runRecordedOperationEffect(operation),
      { discard: true }
    )
  }
})

const runLegacyEffect = Effect.fn("relay.updater.runLegacy")(function* () {
  const operationId = requiredEnvironment("KILN_UPDATE_OPERATION_ID")
  const operation = yield* readOperationEffect(operationId)
  yield* Effect.sleep("1500 millis")
  yield* runRecordedOperationEffect(
    operation,
    requiredEnvironment("KILN_UPDATE_TARGET_REFERENCE")
  )
})

const updaterEffect = (
  batchId ? runBatchEffect(batchId) : runLegacyEffect()
).pipe(Effect.withSpan("relay.updater.run"))

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

function readOperationEffect(id: string) {
  return updaterOperation("readOperation", () =>
    readFile(operationPath(id), "utf8")
  ).pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: () => {
          const decoded: unknown = JSON.parse(text)
          if (!isUpdateOperation(decoded)) {
            throw new Error("Invalid update operation")
          }
          return decoded
        },
        catch: (cause) =>
          updaterError("decodeOperation", "Invalid update operation", cause),
      })
    )
  )
}

function readBatchEffect(id: string) {
  return updaterOperation("readBatch", () =>
    readFile(join(operationsDirectory, `${id}.batch.json`), "utf8")
  ).pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: () => {
          const decoded: unknown = JSON.parse(text)
          if (!isUpdateBatch(decoded) || decoded.id !== id) {
            throw new Error("Invalid update batch")
          }
          return decoded
        },
        catch: (cause) =>
          updaterError("decodeBatch", "Invalid update batch", cause),
      })
    )
  )
}

function updateOperationEffect(operation: UpdateOperation) {
  const path = operationPath(operation.id)
  const temporary = `${path}.${process.pid}.tmp`
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
      rename(temporary, path)
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

function optionalEnvironment(name: string): string | null {
  return process.env[name]?.trim() || null
}

function operationPath(id: string): string {
  return join(operationsDirectory, `${id}.json`)
}

function isUpdateOperation(value: unknown): value is UpdateOperation {
  return (
    isRecord(value) &&
    optionalString(value.batchId) &&
    (value.component === "hearth" || value.component === "relay") &&
    (value.error === null || typeof value.error === "string") &&
    (value.finishedAt === null || typeof value.finishedAt === "string") &&
    typeof value.id === "string" &&
    typeof value.previousImage === "string" &&
    typeof value.requestedImage === "string" &&
    typeof value.startedAt === "string" &&
    (value.status === "failed" ||
      value.status === "running" ||
      value.status === "succeeded") &&
    typeof value.targetContainer === "string" &&
    optionalString(value.targetReference) &&
    typeof value.version === "string"
  )
}

function isUpdateBatch(value: unknown): value is UpdateBatch {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    Array.isArray(value.operationIds) &&
    value.operationIds.every((id) => typeof id === "string")
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string"
}
