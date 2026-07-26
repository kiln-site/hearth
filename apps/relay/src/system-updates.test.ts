import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vite-plus/test"

import {
  imageVersionMatchesRelease,
  SystemUpdateManager,
  type UpdateOperation,
} from "./system-updates.js"
import { KILN_IMAGE_SOURCE } from "./update-container.js"
import type { CommandOptions, CommandResult } from "./command.js"

const targetImage = `ghcr.io/kiln-site/relay@sha256:${"a".repeat(64)}`

const relayContainer = {
  Config: {
    Hostname: "custom-relay-hostname",
    Image: "ghcr.io/kiln-site/relay:latest",
    Labels: {
      "io.kiln.component": "relay",
      "org.opencontainers.image.source": KILN_IMAGE_SOURCE,
      "org.opencontainers.image.version": "0.1.0-nightly.1",
    },
  },
  Id: "relay-container-id",
  Name: "/kiln-relay",
}

class FakeCommand {
  readonly calls: Array<Array<string>> = []
  currentVersion = "0.1.0-nightly.1"
  helperRunning = true
  holdPull = false
  pullStarted: Promise<void>
  #pullStarted: (() => void) | null = null

  constructor() {
    this.pullStarted = new Promise((resolve) => {
      this.#pullStarted = resolve
    })
  }

  readonly run = async (
    _executable: string,
    arguments_: Array<string>,
    options: CommandOptions = {}
  ): Promise<CommandResult> => {
    this.calls.push(arguments_)
    if (arguments_[0] === "pull") {
      this.#pullStarted?.()
      if (this.holdPull) await waitForAbort(options.signal)
      return emptyResult()
    }
    if (arguments_[0] === "image" && arguments_[1] === "inspect") {
      return jsonResult([
        {
          Config: {
            Labels: {
              "io.kiln.component": "relay",
              "org.opencontainers.image.source": KILN_IMAGE_SOURCE,
              "org.opencontainers.image.version": "0.1.0-nightly.18",
            },
          },
        },
      ])
    }
    if (arguments_[0] === "inspect") {
      const identifier = arguments_[1]
      if (identifier?.startsWith("kiln-updater-")) {
        return jsonResult([{ State: { Running: this.helperRunning } }])
      }
      if (
        identifier === "kiln-relay" ||
        identifier === relayContainer.Id ||
        arguments_.includes(relayContainer.Id)
      ) {
        return jsonResult([
          {
            ...relayContainer,
            Config: {
              ...relayContainer.Config,
              Labels: {
                ...relayContainer.Config.Labels,
                "org.opencontainers.image.version": this.currentVersion,
              },
            },
          },
        ])
      }
      throw new Error("No such container")
    }
    if (arguments_[0] === "ps" && arguments_[1] === "--quiet") {
      return { stderr: "", stdout: `${relayContainer.Id}\n` }
    }
    if (arguments_[0] === "ps" && arguments_[1] === "--all") {
      return { stderr: "", stdout: "" }
    }
    return emptyResult()
  }
}

describe("release image versions", () => {
  it("accepts a promoted nightly digest for its stable release", () => {
    expect(imageVersionMatchesRelease("0.1.0-nightly.18", "0.1.0")).toBe(true)
    expect(imageVersionMatchesRelease("0.1.1-nightly.1", "0.1.0")).toBe(false)
    expect(
      imageVersionMatchesRelease("0.1.0-nightly.18", "0.1.0-nightly.19")
    ).toBe(false)
  })

  it("starts a stable update from the promoted image digest", async () => {
    const dataDirectory = await temporaryDataDirectory()
    try {
      const docker = new FakeCommand()
      const manager = new SystemUpdateManager({ dataDirectory }, docker.run)

      const operation = await manager.start({
        helperImage: targetImage,
        targetContainer: "kiln-relay",
        targetImage,
        version: "0.1.0",
      })

      expect(operation.status).toBe("running")
      const run = docker.calls.find((arguments_) => arguments_[0] === "run")
      expect(run).toContain("KILN_UPDATE_VERSION=0.1.0")
      expect(run).toContain(relayContainer.Id)
    } finally {
      await removeTemporaryDirectory(dataDirectory)
    }
  })

  it("refuses to downgrade a managed container", async () => {
    const dataDirectory = await temporaryDataDirectory()
    try {
      const docker = new FakeCommand()
      docker.currentVersion = "0.1.0-nightly.12"
      const manager = new SystemUpdateManager({ dataDirectory }, docker.run)

      await expect(
        manager.start({
          helperImage: targetImage,
          targetContainer: "kiln-relay",
          targetImage,
          version: "0.1.0-nightly.8",
        })
      ).rejects.toThrow(
        "Refusing to downgrade 0.1.0-nightly.12 to 0.1.0-nightly.8"
      )
      expect(docker.calls.some((arguments_) => arguments_[0] === "pull")).toBe(
        false
      )
    } finally {
      await removeTemporaryDirectory(dataDirectory)
    }
  })
})

describe("update operation lifecycle", () => {
  it("rejects a concurrent apply and records cancellation before launch", async () => {
    const dataDirectory = await temporaryDataDirectory()
    try {
      const docker = new FakeCommand()
      docker.holdPull = true
      const manager = new SystemUpdateManager({ dataDirectory }, docker.run)
      const controller = new AbortController()
      const first = manager.start(
        {
          helperImage: targetImage,
          targetContainer: "kiln-relay",
          targetImage,
          version: "0.1.0",
        },
        controller.signal
      )
      await docker.pullStarted

      await expect(
        manager.start({
          helperImage: targetImage,
          targetContainer: "kiln-relay",
          targetImage,
          version: "0.1.0",
        })
      ).rejects.toThrow("already running")

      controller.abort(new Error("cancelled by Hearth"))
      await expect(first).rejects.toThrow("cancelled by Hearth")
      expect(docker.calls.some((arguments_) => arguments_[0] === "run")).toBe(
        false
      )

      const operationFiles = (
        await readdir(join(dataDirectory, "updates"))
      ).filter((name) => name.endsWith(".json"))
      expect(operationFiles).toHaveLength(1)
      expect(
        await readFile(
          join(dataDirectory, "updates", operationFiles[0] ?? ""),
          "utf8"
        )
      ).toContain('"status": "failed"')
    } finally {
      await removeTemporaryDirectory(dataDirectory)
    }
  })

  it("does not time out a running helper and cleans up a stopped helper", async () => {
    const dataDirectory = await temporaryDataDirectory()
    try {
      const docker = new FakeCommand()
      const manager = new SystemUpdateManager({ dataDirectory }, docker.run)
      const operation = staleOperation()
      const updatesDirectory = join(dataDirectory, "updates")
      await mkdir(updatesDirectory, { recursive: true })
      await writeFile(
        join(updatesDirectory, `${operation.id}.json`),
        JSON.stringify(operation)
      )

      expect((await manager.status(operation.id))?.status).toBe("running")
      expect(
        docker.calls.some(
          (arguments_) =>
            arguments_[0] === "rm" &&
            arguments_.includes(`kiln-updater-${operation.id}`)
        )
      ).toBe(false)

      docker.helperRunning = false
      const failed = await manager.status(operation.id)
      expect(failed?.status).toBe("failed")
      expect(
        docker.calls.some(
          (arguments_) =>
            arguments_[0] === "rm" &&
            arguments_.includes("--force") &&
            arguments_.includes(`kiln-updater-${operation.id}`)
        )
      ).toBe(true)
    } finally {
      await removeTemporaryDirectory(dataDirectory)
    }
  })

  it("recovers an orphaned target lock", async () => {
    const dataDirectory = await temporaryDataDirectory()
    try {
      const docker = new FakeCommand()
      const manager = new SystemUpdateManager({ dataDirectory }, docker.run)
      const updatesDirectory = join(dataDirectory, "updates")
      const lockPath = join(updatesDirectory, "kiln-relay.lock")
      await mkdir(updatesDirectory, { recursive: true })
      await writeFile(lockPath, "22222222-2222-4222-8222-222222222222\n")
      await utimes(lockPath, new Date(0), new Date(0))

      const operation = await manager.start({
        helperImage: targetImage,
        targetContainer: "kiln-relay",
        targetImage,
        version: "0.1.0",
      })

      expect(operation.status).toBe("running")
    } finally {
      await removeTemporaryDirectory(dataDirectory)
    }
  })
})

describe("container identity", () => {
  it("falls back from a custom hostname to the matching Docker container", async () => {
    const dataDirectory = await temporaryDataDirectory()
    try {
      const docker = new FakeCommand()
      const manager = new SystemUpdateManager({ dataDirectory }, docker.run)

      const inspection = await manager.inspect("custom-relay-hostname")

      expect(inspection.container).toBe("kiln-relay")
      expect(inspection.eligible).toBe(true)
    } finally {
      await removeTemporaryDirectory(dataDirectory)
    }
  })
})

function staleOperation(): UpdateOperation {
  return {
    component: "relay",
    error: null,
    finishedAt: null,
    id: "11111111-1111-4111-8111-111111111111",
    previousImage: "ghcr.io/kiln-site/relay:latest",
    requestedImage: targetImage,
    startedAt: "2020-01-01T00:00:00.000Z",
    status: "running",
    targetContainer: "kiln-relay",
    version: "0.1.0",
  }
}

async function temporaryDataDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kiln-system-updates-"))
}

async function removeTemporaryDirectory(directory: string): Promise<void> {
  if (!directory.startsWith(join(tmpdir(), "kiln-system-updates-"))) {
    throw new Error("Refusing to remove a non-test directory")
  }
  await rm(directory, { force: true, recursive: true })
}

function emptyResult(): CommandResult {
  return { stderr: "", stdout: "" }
}

function jsonResult(value: unknown): CommandResult {
  return { stderr: "", stdout: JSON.stringify(value) }
}

async function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  if (!signal) throw new Error("Expected an abort signal")
  if (signal.aborted) throw abortError(signal)
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(abortError(signal)), {
      once: true,
    })
  })
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("cancelled")
}
