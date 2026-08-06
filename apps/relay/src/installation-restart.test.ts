import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vite-plus/test"

const commandMock = vi.hoisted(() => vi.fn())

vi.mock("./command.js", () => ({ command: commandMock }))

import { loadConfig } from "./config.js"
import { DockerDriver } from "./docker.js"
import { INSTALLATION_MARKER_LABEL } from "./installation-marker.js"

const temporaryDirectories: Array<string> = []

afterEach(async () => {
  commandMock.mockReset()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe("Relay-owned restart policy", () => {
  async function inspectInstaller(input: {
    installationComplete: boolean
    restartPolicy?: string
    startedAt: string
  }) {
    const dataDirectory = await mkdtemp(join(tmpdir(), "kiln-installation-"))
    temporaryDirectories.push(dataDirectory)
    const config = loadConfig({
      KILN_RELAY_DATA_DIR: dataDirectory,
      KILN_RELAY_RESOURCE_NAMESPACE: "installation-test",
      NODE_ENV: "test",
    })
    const id = "a".repeat(40)
    const serverDirectory = join(config.rootDirectory, id)
    await mkdir(serverDirectory, { recursive: true })
    if (input.installationComplete) {
      await writeFile(join(serverDirectory, ".kiln-ember-installed"), "")
    }

    const container = {
      Config: {
        Image: "kiln-ember:test",
        Labels: {
          [INSTALLATION_MARKER_LABEL]: ".kiln-ember-installed",
          "kiln.relay.owner": "installation-test",
          "kiln.instance.directory": id,
          "kiln.instance.disk-bytes": String(1024 * 1024 * 1024),
          "kiln.instance.memory-bytes": String(1024 * 1024 * 1024),
          "kiln.instance.mount": "/server",
          "kiln.relay.managed": "true",
          "kiln.relay.owned": "true",
          "kiln.server.id": id,
        },
        Tty: false,
      },
      HostConfig: {
        Memory: 1024 * 1024 * 1024,
        PortBindings: {},
        RestartPolicy: { Name: input.restartPolicy ?? "no" },
      },
      Id: "container-id",
      Mounts: [{ Destination: "/server", RW: true, Source: serverDirectory }],
      Name: "/installation-test-kiln-aaaaaaaa",
      NetworkSettings: { Networks: {}, Ports: {} },
      State: {
        ExitCode: 0,
        OOMKilled: false,
        Restarting: false,
        Running: true,
        StartedAt: input.startedAt,
        Status: "running",
      },
    }

    commandMock.mockImplementation(
      async (_executable: string, arguments_: Array<string>) => {
        if (arguments_[0] === "container" && arguments_[1] === "ls") {
          return { stderr: "", stdout: `${container.Id}\n` }
        }
        if (arguments_[0] === "inspect") {
          return { stderr: "", stdout: JSON.stringify([container]) }
        }
        return { stderr: "", stdout: "" }
      }
    )

    return new DockerDriver(config).inspectInstances()
  }

  it("takes over restart ownership from an existing Docker policy", async () => {
    await inspectInstaller({
      installationComplete: true,
      restartPolicy: "unless-stopped",
      startedAt: new Date().toISOString(),
    })

    expect(commandMock).toHaveBeenCalledWith("docker", [
      "update",
      "--restart=no",
      "installation-test-kiln-aaaaaaaa",
    ])
  })

  it("leaves installer-aware containers on restart=no", async () => {
    await inspectInstaller({
      installationComplete: false,
      startedAt: "2026-08-05T20:00:00.000Z",
    })

    expect(commandMock).not.toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["update"])
    )
  })
})
