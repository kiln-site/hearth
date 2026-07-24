import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { hostname } from "node:os"
import { join } from "node:path"

import { command } from "./command.js"
import type { RelayConfig } from "./config.js"

const IMAGE_SOURCE = "https://github.com/kiln-site/hearth"
const RELEASE_IMAGE =
  /^ghcr\.io\/kiln-site\/(hearth|relay)@sha256:[a-f0-9]{64}$/u

type KilnComponent = "hearth" | "relay"

interface ContainerInspect {
  Config: {
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
  readonly #operationsDirectory: string

  constructor(config: RelayConfig) {
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
    const inspected = await inspectContainer(container)
    const labels = inspected.Config.Labels ?? {}
    const component = kilnComponent(labels["io.kiln.component"])
    const currentImage = inspected.Config.Image
    const official = labels["org.opencontainers.image.source"] === IMAGE_SOURCE
    const eligibleTag =
      currentImage === "ghcr.io/kiln-site/hearth:latest" ||
      currentImage === "ghcr.io/kiln-site/hearth:latest-nightly" ||
      currentImage === "ghcr.io/kiln-site/relay:latest" ||
      currentImage === "ghcr.io/kiln-site/relay:latest-nightly"

    return {
      component,
      container: inspected.Name.replace(/^\//u, ""),
      currentImage,
      currentVersion:
        labels["org.opencontainers.image.version"]?.trim() || null,
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

  async start(input: {
    helperImage: string
    targetContainer: string
    targetImage: string
    version: string
  }): Promise<UpdateOperation> {
    const helperComponent = releaseImageComponent(input.helperImage)
    if (helperComponent !== "relay") {
      throw new Error("The update helper must be an official Relay digest")
    }
    const targetComponent = releaseImageComponent(input.targetImage)
    const target = await inspectContainer(input.targetContainer)
    const targetLabels = target.Config.Labels ?? {}
    if (
      targetLabels["org.opencontainers.image.source"] !== IMAGE_SOURCE ||
      kilnComponent(targetLabels["io.kiln.component"]) !== targetComponent
    ) {
      throw new Error(
        "The selected container is not an official Kiln component"
      )
    }
    const eligibility = await this.inspect(input.targetContainer)
    if (!eligibility.eligible) {
      throw new Error(eligibility.reason ?? "This container cannot be updated")
    }

    if (input.helperImage === input.targetImage) {
      await pullAndVerifyImage(input.helperImage, "relay")
    } else {
      await Promise.all([
        pullAndVerifyImage(input.helperImage, "relay"),
        pullAndVerifyImage(input.targetImage, targetComponent),
      ])
    }
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
    await writeOperation(this.#operationsDirectory, operation)

    const helperName = `kiln-updater-${id}`
    try {
      await command(
        "docker",
        [
          "run",
          "--detach",
          "--name",
          helperName,
          "--label",
          "io.kiln.update-helper=true",
          "--volumes-from",
          hostname(),
          "--env",
          `KILN_UPDATE_DATA_DIR=${this.#operationsDirectory}`,
          "--env",
          `KILN_UPDATE_OPERATION_ID=${id}`,
          "--env",
          `KILN_UPDATE_TARGET_CONTAINER=${operation.targetContainer}`,
          "--env",
          `KILN_UPDATE_TARGET_IMAGE=${input.targetImage}`,
          "--env",
          `KILN_UPDATE_VERSION=${input.version}`,
          input.helperImage,
          "dist/src/updater.mjs",
        ],
        { timeout: 90_000 }
      )
    } catch (cause) {
      const failed = {
        ...operation,
        error: cause instanceof Error ? cause.message : "Update helper failed",
        finishedAt: new Date().toISOString(),
        status: "failed" as const,
      }
      await writeOperation(this.#operationsDirectory, failed)
      return failed
    }

    return operation
  }

  async status(id: string): Promise<UpdateOperation | null> {
    if (!/^[0-9a-f-]{36}$/u.test(id)) return null
    try {
      const operation = JSON.parse(
        await readFile(join(this.#operationsDirectory, `${id}.json`), "utf8")
      ) as UpdateOperation
      if (
        operation.status === "running" &&
        Date.now() - Date.parse(operation.startedAt) > 10 * 60_000
      ) {
        const failed: UpdateOperation = {
          ...operation,
          error:
            "The update helper stopped reporting. Inspect its Docker logs before trying again.",
          finishedAt: new Date().toISOString(),
          status: "failed",
        }
        await writeOperation(this.#operationsDirectory, failed)
        return failed
      }
      if (operation.status === "succeeded") {
        await command("docker", ["rm", `kiln-updater-${id}`]).catch(
          () => undefined
        )
      }
      return operation
    } catch (cause) {
      const error = cause as NodeJS.ErrnoException
      if (error.code === "ENOENT") return null
      throw cause
    }
  }
}

async function inspectContainer(container: string): Promise<ContainerInspect> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u.test(container)) {
    throw new Error("Invalid Docker container identifier")
  }
  const result = await command("docker", ["inspect", container])
  const inspected = (JSON.parse(result.stdout) as Array<ContainerInspect>)[0]
  if (!inspected) throw new Error("Docker could not inspect the container")
  return inspected
}

async function pullAndVerifyImage(
  image: string,
  expectedComponent: KilnComponent
): Promise<void> {
  await command("docker", ["pull", image], { timeout: 10 * 60_000 })
  const result = await command("docker", ["image", "inspect", image])
  const inspected = (JSON.parse(result.stdout) as Array<ImageInspect>)[0]
  const labels = inspected?.Config?.Labels ?? {}
  if (
    labels["org.opencontainers.image.source"] !== IMAGE_SOURCE ||
    labels["io.kiln.component"] !== expectedComponent
  ) {
    throw new Error(`The ${expectedComponent} image failed provenance checks`)
  }
}

function releaseImageComponent(image: string): KilnComponent {
  const match = RELEASE_IMAGE.exec(image)
  if (!match)
    throw new Error("Updates require an official immutable GHCR digest")
  return match[1] as KilnComponent
}

function kilnComponent(value: string | undefined): KilnComponent | null {
  return value === "hearth" || value === "relay" ? value : null
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
