import { randomUUID } from "node:crypto"
import {
  link,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { hostname } from "node:os"
import { join } from "node:path"

import {
  compareKilnReleaseVersions,
  isKilnReleaseVersion,
} from "@workspace/contracts"

import { command } from "./command.js"
import type { CommandOptions, CommandResult } from "./command.js"
import type { RelayConfig } from "./config.js"
import {
  KILN_IMAGE_SOURCE,
  kilnComponent,
  managedImageChannel,
  type KilnComponent,
} from "./update-container.js"

const RELEASE_IMAGE =
  /^ghcr\.io\/kiln-site\/(hearth|relay)@sha256:[a-f0-9]{64}$/u
const STALE_UPDATE_MS = 10 * 60_000
const ORPHAN_LOCK_MS = 30_000

type RunCommand = (
  executable: string,
  arguments_: Array<string>,
  options?: CommandOptions
) => Promise<CommandResult>

interface ContainerInspect {
  Config: {
    Hostname?: string
    Image: string
    Labels: Record<string, string | undefined> | null
  }
  Id: string
  Name: string
}

interface ImageInspect {
  Config?: {
    Labels?: Record<string, string | undefined> | null
  }
}

interface HelperInspect {
  State?: {
    Running?: boolean
  }
}

export interface UpdateOperation {
  component: KilnComponent
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

export class SystemUpdateManager {
  readonly #command: RunCommand
  readonly #operationsDirectory: string

  constructor(
    config: Pick<RelayConfig, "dataDirectory">,
    runCommand: RunCommand = command
  ) {
    this.#command = runCommand
    this.#operationsDirectory = join(config.dataDirectory, "updates")
  }

  async inspect(container: string): Promise<{
    component: KilnComponent | null
    container: string
    currentImage: string
    currentVersion: string | null
    eligible: boolean
    reason: string | null
  }> {
    return updateEligibility(await inspectContainer(container, this.#command))
  }

  async start(
    input: {
      helperImage: string
      targetContainer: string
      targetImage: string
      version: string
    },
    signal?: AbortSignal
  ): Promise<UpdateOperation> {
    throwIfAborted(signal)
    const helperComponent = releaseImageComponent(input.helperImage)
    if (helperComponent !== "relay") {
      throw new Error("The update helper must be an official Relay digest")
    }
    const targetComponent = releaseImageComponent(input.targetImage)
    const target = await inspectContainer(input.targetContainer, this.#command)
    const eligibility = updateEligibility(target)
    if (eligibility.component !== targetComponent) {
      throw new Error(
        "The selected container is not an official Kiln component"
      )
    }
    if (!eligibility.eligible) {
      throw new Error(eligibility.reason ?? "This container cannot be updated")
    }
    if (!isKilnReleaseVersion(input.version)) {
      throw new Error("The requested Kiln release version is invalid")
    }
    if (
      isKilnReleaseVersion(eligibility.currentVersion) &&
      compareKilnReleaseVersions(input.version, eligibility.currentVersion) ===
        -1
    ) {
      throw new Error(
        `Refusing to downgrade ${eligibility.currentVersion} to ${input.version}`
      )
    }
    const targetReference = managedImageChannel(
      target.Config.Image,
      targetComponent
    )
    if (!targetReference) {
      throw new Error("The target no longer uses a managed channel tag")
    }

    throwIfAborted(signal)
    await mkdir(this.#operationsDirectory, { recursive: true, mode: 0o700 })
    const id = randomUUID()
    const operation: UpdateOperation = {
      component: targetComponent,
      error: null,
      finishedAt: null,
      id,
      previousImage: target.Config.Image,
      requestedImage: input.targetImage,
      startedAt: new Date().toISOString(),
      status: "running",
      targetContainer: target.Name.replace(/^\//u, ""),
      version: input.version,
    }
    await acquireTargetLock(this.#operationsDirectory, operation)
    try {
      await writeOperation(this.#operationsDirectory, operation)
    } catch (cause) {
      await releaseTargetLock(
        this.#operationsDirectory,
        operation.targetContainer,
        operation.id
      )
      throw cause
    }

    const helperName = `kiln-updater-${id}`
    try {
      let targetImage: ImageInspect
      if (input.helperImage === input.targetImage) {
        targetImage = await pullAndVerifyImage(
          input.helperImage,
          "relay",
          this.#command,
          signal
        )
      } else {
        const [, inspectedTarget] = await Promise.all([
          pullAndVerifyImage(input.helperImage, "relay", this.#command, signal),
          pullAndVerifyImage(
            input.targetImage,
            targetComponent,
            this.#command,
            signal
          ),
        ])
        targetImage = inspectedTarget
      }
      const imageVersion =
        targetImage.Config?.Labels?.["org.opencontainers.image.version"]
      if (!imageVersionMatchesRelease(imageVersion, input.version)) {
        throw new Error("The target image version does not match the release")
      }

      const volumesFrom =
        targetComponent === "relay"
          ? target
          : await inspectContainer(hostname(), this.#command)
      const volumesFromLabels = volumesFrom.Config.Labels ?? {}
      if (
        kilnComponent(volumesFromLabels["io.kiln.component"]) !== "relay" ||
        volumesFromLabels["org.opencontainers.image.source"] !==
          KILN_IMAGE_SOURCE
      ) {
        throw new Error("Docker could not identify this Relay container")
      }

      throwIfAborted(signal)
      await this.#command(
        "docker",
        [
          "run",
          "--detach",
          "--name",
          helperName,
          "--label",
          "io.kiln.update-helper=true",
          "--volumes-from",
          volumesFrom.Id,
          "--env",
          `KILN_UPDATE_DATA_DIR=${this.#operationsDirectory}`,
          "--env",
          `KILN_UPDATE_OPERATION_ID=${id}`,
          "--env",
          `KILN_UPDATE_TARGET_CONTAINER=${operation.targetContainer}`,
          "--env",
          `KILN_UPDATE_TARGET_IMAGE=${input.targetImage}`,
          "--env",
          `KILN_UPDATE_TARGET_REFERENCE=${targetReference}`,
          "--env",
          `KILN_UPDATE_VERSION=${input.version}`,
          input.helperImage,
          "dist/src/updater.mjs",
        ],
        { signal, timeout: 90_000 }
      )
      throwIfAborted(signal)
      return operation
    } catch (cause) {
      await cleanupHelper(this.#command, id)
      const failed: UpdateOperation = {
        ...operation,
        error: signal?.aborted
          ? "The update request was cancelled before replacement started."
          : cause instanceof Error
            ? cause.message
            : "Update helper failed",
        finishedAt: new Date().toISOString(),
        status: "failed",
      }
      await writeOperation(this.#operationsDirectory, failed)
      await releaseTargetLock(
        this.#operationsDirectory,
        operation.targetContainer,
        operation.id
      )
      if (signal?.aborted) throw abortReason(signal)
      return failed
    }
  }

  async status(id: string): Promise<UpdateOperation | null> {
    if (!/^[0-9a-f-]{36}$/u.test(id)) return null
    try {
      const operation = await readOperation(this.#operationsDirectory, id)
      if (!operation) return null

      if (
        operation.status === "running" &&
        operationIsStale(operation) &&
        (await helperState(this.#command, id)) === "stopped"
      ) {
        const failed: UpdateOperation = {
          ...operation,
          error:
            "The update helper stopped without reporting an outcome. Inspect its Docker logs before trying again.",
          finishedAt: new Date().toISOString(),
          status: "failed",
        }
        await writeOperation(this.#operationsDirectory, failed)
        await releaseTargetLock(
          this.#operationsDirectory,
          operation.targetContainer,
          operation.id
        )
        await cleanupHelper(this.#command, id)
        return failed
      }

      if (operation.status !== "running") {
        await releaseTargetLock(
          this.#operationsDirectory,
          operation.targetContainer,
          operation.id
        )
        await cleanupHelper(this.#command, id)
      }
      return operation
    } catch (cause) {
      if (errorCode(cause) === "ENOENT") return null
      throw cause
    }
  }
}

export function imageVersionMatchesRelease(
  imageVersion: string | undefined,
  releaseVersion: string
): boolean {
  if (imageVersion === releaseVersion) return true
  if (!/^0\.\d+\.\d+$/u.test(releaseVersion)) return false
  return new RegExp(
    `^${escapeRegularExpression(releaseVersion)}-nightly\\.\\d+$`,
    "u"
  ).test(imageVersion ?? "")
}

function updateEligibility(inspected: ContainerInspect): {
  component: KilnComponent | null
  container: string
  currentImage: string
  currentVersion: string | null
  eligible: boolean
  reason: string | null
} {
  const labels = inspected.Config.Labels ?? {}
  const component = kilnComponent(labels["io.kiln.component"])
  const currentImage = inspected.Config.Image
  const official =
    labels["org.opencontainers.image.source"] === KILN_IMAGE_SOURCE
  const eligibleTag = component
    ? managedImageChannel(currentImage, component)
    : null

  return {
    component,
    container: inspected.Name.replace(/^\//u, ""),
    currentImage,
    currentVersion: labels["org.opencontainers.image.version"]?.trim() || null,
    eligible: Boolean(component && official && eligibleTag),
    reason: !component
      ? "The container is not a Hearth or Relay image."
      : !official
        ? "Only official public Kiln images can be updated."
        : !eligibleTag
          ? "This container is pinned. Change it to :latest or :latest-nightly to enable one-click updates."
          : null,
  }
}

async function inspectContainer(
  container: string,
  runCommand: RunCommand
): Promise<ContainerInspect> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u.test(container)) {
    throw new Error("Invalid Docker container identifier")
  }
  try {
    return await inspectContainerDirect(container, runCommand)
  } catch (directCause) {
    const listed = await runCommand("docker", ["ps", "--quiet"])
    const identifiers = listed.stdout.split(/\s+/u).filter(Boolean)
    if (identifiers.length === 0) throw directCause
    const result = await runCommand("docker", ["inspect", ...identifiers])
    const inspected = decodeJsonArray(result.stdout, isContainerInspect)
    const matches = inspected.filter(
      (candidate) => candidate.Config.Hostname === container
    )
    if (matches.length === 1 && matches[0]) return matches[0]
    if (matches.length > 1) {
      throw new Error(
        `More than one running Docker container uses hostname ${container}`
      )
    }
    throw directCause
  }
}

async function inspectContainerDirect(
  container: string,
  runCommand: RunCommand
): Promise<ContainerInspect> {
  const result = await runCommand("docker", ["inspect", container])
  const inspected = decodeJsonArray(result.stdout, isContainerInspect)[0]
  if (!inspected) throw new Error("Docker could not inspect the container")
  return inspected
}

async function pullAndVerifyImage(
  image: string,
  expectedComponent: KilnComponent,
  runCommand: RunCommand,
  signal?: AbortSignal
): Promise<ImageInspect> {
  throwIfAborted(signal)
  await runCommand("docker", ["pull", image], {
    signal,
    timeout: 10 * 60_000,
  })
  throwIfAborted(signal)
  const result = await runCommand("docker", ["image", "inspect", image], {
    signal,
  })
  const inspected = decodeJsonArray(result.stdout, isImageInspect)[0]
  if (!inspected) throw new Error("Docker could not inspect the pulled image")
  const labels = inspected.Config?.Labels ?? {}
  if (
    labels["org.opencontainers.image.source"] !== KILN_IMAGE_SOURCE ||
    labels["io.kiln.component"] !== expectedComponent
  ) {
    throw new Error(`The ${expectedComponent} image failed provenance checks`)
  }
  return inspected
}

function releaseImageComponent(image: string): KilnComponent {
  if (!RELEASE_IMAGE.test(image)) {
    throw new Error("Updates require an official immutable GHCR digest")
  }
  return image.startsWith("ghcr.io/kiln-site/hearth@") ? "hearth" : "relay"
}

async function acquireTargetLock(
  directory: string,
  operation: UpdateOperation
): Promise<void> {
  const path = targetLockPath(directory, operation.targetContainer)
  for (;;) {
    const temporary = `${path}.${operation.id}.tmp`
    try {
      await writeFile(temporary, `${operation.id}\n`, {
        flag: "wx",
        mode: 0o600,
      })
      await link(temporary, path)
      await rm(temporary, { force: true })
      return
    } catch (cause) {
      await rm(temporary, { force: true })
      if (errorCode(cause) !== "EEXIST") throw cause
      const existingId = (await readFile(path, "utf8")).trim()
      const existing = existingId
        ? await readOperation(directory, existingId)
        : null
      if (!existing) {
        if (await lockIsOrphaned(path)) {
          await releaseTargetLock(
            directory,
            operation.targetContainer,
            existingId
          )
          continue
        }
        throw new Error(
          `An update is starting for ${operation.targetContainer}`
        )
      }
      if (existing.status === "running") {
        throw new Error(
          `An update is already running for ${operation.targetContainer}`
        )
      }
      await releaseTargetLock(directory, operation.targetContainer, existingId)
    }
  }
}

async function lockIsOrphaned(path: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(path)).mtimeMs > ORPHAN_LOCK_MS
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return true
    throw cause
  }
}

async function releaseTargetLock(
  directory: string,
  targetContainer: string,
  operationId: string
): Promise<void> {
  const path = targetLockPath(directory, targetContainer)
  try {
    if ((await readFile(path, "utf8")).trim() !== operationId) return
    await rm(path, { force: true })
  } catch (cause) {
    if (errorCode(cause) !== "ENOENT") throw cause
  }
}

function targetLockPath(directory: string, targetContainer: string): string {
  return join(directory, `${targetContainer}.lock`)
}

async function helperState(
  runCommand: RunCommand,
  id: string
): Promise<"running" | "stopped" | "unknown"> {
  const helperName = `kiln-updater-${id}`
  try {
    const result = await runCommand("docker", ["inspect", helperName])
    const inspected = decodeJsonArray(result.stdout, isHelperInspect)[0]
    return inspected?.State?.Running ? "running" : "stopped"
  } catch {
    try {
      const result = await runCommand("docker", [
        "ps",
        "--all",
        "--quiet",
        "--filter",
        `name=^/${helperName}$`,
      ])
      return result.stdout.trim() ? "unknown" : "stopped"
    } catch {
      return "unknown"
    }
  }
}

async function cleanupHelper(
  runCommand: RunCommand,
  id: string
): Promise<void> {
  await runCommand("docker", ["rm", "--force", `kiln-updater-${id}`]).catch(
    () => undefined
  )
}

function operationIsStale(operation: UpdateOperation): boolean {
  const startedAt = Date.parse(operation.startedAt)
  return Number.isFinite(startedAt) && Date.now() - startedAt > STALE_UPDATE_MS
}

async function readOperation(
  directory: string,
  id: string
): Promise<UpdateOperation | null> {
  try {
    const decoded: unknown = JSON.parse(
      await readFile(join(directory, `${id}.json`), "utf8")
    )
    if (!isUpdateOperation(decoded)) {
      throw new Error("The update operation record is invalid")
    }
    return decoded
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return null
    throw cause
  }
}

async function writeOperation(
  directory: string,
  operation: UpdateOperation
): Promise<void> {
  const path = join(directory, `${operation.id}.json`)
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(operation, null, 2)}\n`, {
    mode: 0o600,
  })
  await rename(temporary, path)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal)
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Relay request was cancelled")
}

function errorCode(cause: unknown): string | null {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "string"
  ) {
    return cause.code
  }
  return null
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

function decodeJsonArray<T>(
  text: string,
  predicate: (value: unknown) => value is T
): Array<T> {
  const decoded: unknown = JSON.parse(text)
  if (!Array.isArray(decoded) || !decoded.every(predicate)) {
    throw new Error("Docker returned an invalid inspection response")
  }
  return decoded
}

function isContainerInspect(value: unknown): value is ContainerInspect {
  if (!isRecord(value) || !isRecord(value.Config)) return false
  return (
    typeof value.Config.Image === "string" &&
    optionalString(value.Config.Hostname) &&
    stringRecordOrNull(value.Config.Labels) &&
    typeof value.Id === "string" &&
    typeof value.Name === "string"
  )
}

function isImageInspect(value: unknown): value is ImageInspect {
  if (!isRecord(value)) return false
  if (value.Config === undefined) return true
  return isRecord(value.Config) && stringRecordOrNull(value.Config.Labels)
}

function isHelperInspect(value: unknown): value is HelperInspect {
  if (!isRecord(value)) return false
  if (value.State === undefined) return true
  return (
    isRecord(value.State) &&
    (value.State.Running === undefined ||
      typeof value.State.Running === "boolean")
  )
}

function isUpdateOperation(value: unknown): value is UpdateOperation {
  if (!isRecord(value)) return false
  return (
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
    typeof value.version === "string"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string"
}

function stringRecordOrNull(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (isRecord(value) &&
      Object.values(value).every(
        (entry) => entry === undefined || typeof entry === "string"
      ))
  )
}
