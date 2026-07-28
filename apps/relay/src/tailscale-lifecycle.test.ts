import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vite-plus/test"
import {
  builtinTailscaleBrickId,
  relayTailscaleStackApplySchema,
  relayTailscaleStackConfigSchema,
  relayTailscaleStackSchema,
} from "@workspace/contracts"

const commandMock = vi.hoisted(() => vi.fn())

vi.mock("./command.js", () => ({ command: commandMock }))

import { BrickCatalog } from "./bricks.js"
import { loadConfig, type RelayInstanceConfig } from "./config.js"
import { DockerDriver } from "./docker.js"
import { LifecycleDriver } from "./lifecycle.js"

const temporaryDirectories: Array<string> = []

afterEach(async () => {
  commandMock.mockReset()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe("Tailscale pending removal recovery", () => {
  it("rejects revival while a failed removal remains retryable", async () => {
    const dataDirectory = await mkdtemp(
      join(tmpdir(), "kiln-tailscale-removal-")
    )
    temporaryDirectories.push(dataDirectory)
    const config = loadConfig({
      KILN_RELAY_DATA_DIR: dataDirectory,
      KILN_RELAY_RESOURCE_NAMESPACE: "pending-removal-test",
      NODE_ENV: "test",
    })
    const id = "a".repeat(40)
    const stackDirectory = join(config.rootDirectory, id)
    const stackConfig = relayTailscaleStackConfigSchema.parse({
      bindings: [],
      domain: "test",
      hostname: "private-network",
      id,
      name: "Private Network",
      subnet: "10.165.55.0/24",
    })
    const snapshot = relayTailscaleStackSchema.parse({
      ...stackConfig,
      components: {
        coreDnsRunning: false,
        tailscaleRunning: false,
      },
      instance: {
        brickId: builtinTailscaleBrickId,
        connectAddress: "private-network.test",
        containerId: "docker-container-id",
        desiredState: "stopped",
        directory: id,
        game: "Networking",
        id,
        implementation: "Tailscale",
        javaVersion: "Tailscale + CoreDNS",
        managedByRelay: true,
        name: "Private Network",
        observedState: "offline",
        service: "pending-removal-test-kiln-ts-aaaaaaaa",
        shortId: id.slice(0, 8),
        startedAt: null,
        status: "Exited (0)",
        version: "stable",
      },
      status: {
        connected: false,
        ipv4Address: null,
        ipv6Address: null,
        message: "Tailscale is stopped",
      },
    })
    await mkdir(stackDirectory, { recursive: true })
    await Promise.all([
      writeFile(
        join(stackDirectory, "stack.json"),
        `${JSON.stringify(stackConfig)}\n`
      ),
      writeFile(join(stackDirectory, ".removing"), "prepared\n"),
      writeFile(
        join(stackDirectory, ".removing-stack.json"),
        `${JSON.stringify(snapshot)}\n`
      ),
    ])

    let networkRemoveAttempts = 0
    commandMock.mockImplementation(
      async (_executable: string, arguments_: Array<string>) => {
        if (arguments_[0] === "container" && arguments_[1] === "inspect") {
          throw new Error("container not found")
        }
        if (arguments_[0] === "network" && arguments_[1] === "inspect") {
          return {
            stderr: "",
            stdout: JSON.stringify({
              "kiln.relay.owner": "pending-removal-test",
            }),
          }
        }
        if (arguments_[0] === "network" && arguments_[1] === "rm") {
          networkRemoveAttempts += 1
          if (networkRemoveAttempts === 1) {
            throw new Error("bridge is still in use")
          }
        }
        return { stderr: "", stdout: "" }
      }
    )

    const lifecycle = new LifecycleDriver(
      config,
      new DockerDriver(config),
      new BrickCatalog(config.brickCatalogUrl)
    )

    await expect(lifecycle.removeTailscaleStack(id)).rejects.toThrow(
      "bridge is still in use"
    )
    const commandCallsAfterCleanupFailure = commandMock.mock.calls.length
    expect((await lifecycle.tailscaleStacks())[0]?.status.message).toBe(
      "Removal pending"
    )

    const apply = relayTailscaleStackApplySchema.parse({
      bindings: [],
      domain: "test",
      hostname: "private-network",
      id,
      name: "Private Network",
    })
    await expect(lifecycle.applyTailscaleStack(apply)).rejects.toThrow(
      "removal cleanup is pending"
    )

    const instance: RelayInstanceConfig = {
      brickId: builtinTailscaleBrickId,
      connectAddress: "private-network.test",
      directory: id,
      game: "Networking",
      id,
      implementation: "Tailscale",
      javaVersion: "Tailscale + CoreDNS",
      limits: {
        diskBytes: 128 * 1024 * 1024,
        memoryBytes: 64 * 1024 * 1024,
      },
      managedByRelay: true,
      name: "Private Network",
      service: "pending-removal-test-kiln-ts-aaaaaaaa",
      shortId: id.slice(0, 8),
      tailscale: { enabled: false },
      version: "stable",
    }
    await expect(
      lifecycle.runInstanceAction(instance, "start", [])
    ).rejects.toThrow("removal cleanup is pending")
    await expect(
      lifecycle.runInstanceAction(instance, "restart", [])
    ).rejects.toThrow("removal cleanup is pending")
    expect(commandMock).toHaveBeenCalledTimes(commandCallsAfterCleanupFailure)

    await lifecycle.removeTailscaleStack(id)

    expect(networkRemoveAttempts).toBe(2)
    await expect(access(stackDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    })
  })
})
