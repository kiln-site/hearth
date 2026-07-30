import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vite-plus/test"
import {
  relayInstanceSchema,
  type RelayInstance,
  type RelayInstancePortAllocation,
} from "@workspace/contracts"

const commandMock = vi.hoisted(() => vi.fn())

vi.mock("./command.js", () => ({ command: commandMock }))

import type { BrickCatalog } from "./bricks.js"
import { loadConfig } from "./config.js"
import type { DockerDriver } from "./docker.js"
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

describe("instance port lifecycle", () => {
  it("bootstraps a missing primary allocation from a primary port input", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "kiln-primary-port-"))
    temporaryDirectories.push(dataDirectory)
    const config = loadConfig({
      KILN_RELAY_DATA_DIR: dataDirectory,
      KILN_RELAY_GAME_PORT_RANGE: "32123-32123",
      KILN_RELAY_PROXY: "hearth",
      KILN_RELAY_RESOURCE_NAMESPACE: "primary-port-test",
      NODE_ENV: "test",
    })
    const instance = relayInstanceSchema.parse({
      brickNetworkMode: "direct",
      connectAddress: "legacy.test",
      containerId: "legacy-container",
      desiredState: "stopped",
      directory: "a".repeat(40),
      game: "Minecraft",
      id: "a".repeat(40),
      implementation: "Paper",
      javaVersion: "21",
      managedByRelay: true,
      name: "Legacy server",
      observedState: "stopped",
      publicHost: "legacy.test",
      service: "kiln-legacy",
      shortId: "aaaaaaaa",
      startedAt: null,
      status: "created",
      version: "1.21.11",
    })
    const primary = {
      externalPort: 32_123,
      id: "primary",
      internalPort: 25_565,
      kind: "primary",
      name: "Game server port",
      protocol: "tcp",
    } satisfies RelayInstancePortAllocation
    const recreateOwnedInstance = vi.fn(
      async (): Promise<RelayInstance> => ({
        ...instance,
        connectAddress: "legacy.test:32123",
        ports: [primary],
        publicPort: 32_123,
      })
    )
    const docker = {
      inspectInstances: vi.fn(async () => [instance]),
      publishedHostPorts: vi.fn(async () => []),
      recreateOwnedInstance,
    } as unknown as DockerDriver
    commandMock.mockRejectedValue(new Error("container not found"))
    const lifecycle = new LifecycleDriver(config, docker, {} as BrickCatalog)

    const updated = await lifecycle.updateInstancePorts(
      instance.id,
      [
        {
          id: "primary",
          internalPort: 25_565,
          name: "Ignored client name",
          protocol: "tcp",
        },
      ],
      []
    )

    expect(updated.ports).toEqual([primary])
    expect(recreateOwnedInstance).toHaveBeenCalledWith(
      instance,
      {
        "kiln.relay.web-routes.revision":
          "809b57ac6cc136a5e7bb9babc8418a73d2cfafcb6cfb1e1697214c164a001631",
        "traefik.enable": "false",
      },
      null,
      "stop",
      {
        bindings: {
          "25565/tcp": [{ HostIp: "", HostPort: "32123" }],
        },
        labels: {
          "kiln.brick.primary-port": "25565/tcp",
          "kiln.traefik.service.port": "25565",
        },
      }
    )
  })

  it("waits for a manual restart before applying a missing primary port", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "kiln-primary-port-"))
    temporaryDirectories.push(dataDirectory)
    const config = loadConfig({
      KILN_RELAY_DATA_DIR: dataDirectory,
      KILN_RELAY_GAME_PORT_RANGE: "32124-32124",
      KILN_RELAY_PROXY: "hearth",
      KILN_RELAY_RESOURCE_NAMESPACE: "pending-primary-port-test",
      NODE_ENV: "test",
    })
    const instance = relayInstanceSchema.parse({
      brickNetworkMode: "direct",
      connectAddress: "legacy.test",
      containerId: "legacy-container",
      desiredState: "running",
      directory: "b".repeat(40),
      game: "Minecraft",
      id: "b".repeat(40),
      implementation: "Paper",
      javaVersion: "21",
      managedByRelay: true,
      name: "Running legacy server",
      observedState: "running",
      publicHost: "legacy.test",
      service: "kiln-running-legacy",
      shortId: "bbbbbbbb",
      startedAt: new Date().toISOString(),
      status: "running",
      version: "1.21.11",
    })
    await mkdir(join(config.rootDirectory, instance.directory), {
      recursive: true,
    })
    const primary = {
      externalPort: 32_124,
      id: "primary",
      internalPort: 25_565,
      kind: "primary",
      name: "Game server port",
      protocol: "tcp",
    } satisfies RelayInstancePortAllocation
    const recreateOwnedInstance = vi.fn(
      async (): Promise<RelayInstance> => ({
        ...instance,
        connectAddress: "legacy.test:32124",
        ports: [primary],
        publicPort: 32_124,
      })
    )
    const docker = {
      inspectInstances: vi.fn(async () => [instance]),
      publishedHostPorts: vi.fn(async () => []),
      recreateOwnedInstance,
      runAction: vi.fn(),
    } as unknown as DockerDriver
    commandMock.mockRejectedValue(new Error("container not found"))
    const lifecycle = new LifecycleDriver(config, docker, {} as BrickCatalog)

    const staged = await lifecycle.updateInstancePorts(
      instance.id,
      [
        {
          id: "primary",
          internalPort: 25_565,
          name: "Ignored client name",
          protocol: "tcp",
        },
      ],
      []
    )

    expect(staged.pendingPrimaryPort).toEqual({
      id: "primary",
      internalPort: 25_565,
      name: "Game server port",
      protocol: "tcp",
    })
    expect(staged.ports).toEqual([])
    expect(recreateOwnedInstance).not.toHaveBeenCalled()

    const updated = await lifecycle.runInstanceAction(
      instance,
      "restart",
      [],
      staged.pendingPrimaryPort
    )

    expect(updated.ports).toEqual([primary])
    expect(recreateOwnedInstance).toHaveBeenCalledWith(
      instance,
      {
        "kiln.relay.web-routes.revision":
          "809b57ac6cc136a5e7bb9babc8418a73d2cfafcb6cfb1e1697214c164a001631",
        "traefik.enable": "false",
      },
      null,
      "restart",
      {
        bindings: {
          "25565/tcp": [{ HostIp: "", HostPort: "32124" }],
        },
        labels: {
          "kiln.brick.primary-port": "25565/tcp",
          "kiln.traefik.service.port": "25565",
        },
      }
    )
  })
})
