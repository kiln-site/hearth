import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { afterEach, describe, expect, it } from "vite-plus/test"

import { loadConfig } from "./config.js"
import { FilesystemDriver } from "./files.js"
import type { RelayInstanceConfig } from "./config.js"

const temporaryDirectories: Array<string> = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  )
})

describe("Relay direct file transfers", () => {
  it("atomically uploads and reads through a pinned file handle", async () => {
    const { driver, instance, root } = await setup()

    const uploaded = await driver.upload(
      instance,
      "world/data.txt",
      chunks("direct transfer")
    )
    expect(uploaded.size).toBe(15)
    expect(uploaded.sha256).toHaveLength(64)

    const download = await driver.download(instance, "world/data.txt")
    try {
      expect(await download.file.readFile("utf8")).toBe("direct transfer")
      expect(download.size).toBe(15)
    } finally {
      await download.file.close()
    }
    expect(root).toBeTruthy()
  })

  it("refuses a final symlink for uploads and downloads", async () => {
    const { directory, driver, instance, root } = await setup()
    const outside = resolve(directory, "outside.txt")
    await writeFile(outside, "sensitive")
    await symlink(outside, resolve(root, "world", "escape.txt"))

    await expect(driver.download(instance, "world/escape.txt")).rejects.toThrow()
    await expect(
      driver.upload(instance, "world/escape.txt", chunks("overwrite"))
    ).rejects.toThrow("Path is not a file")
  })
})

async function setup() {
  const directory = await mkdtemp(resolve(tmpdir(), "kiln-files-test-"))
  temporaryDirectories.push(directory)
  const root = resolve(directory, "instances", "instance-1")
  await mkdir(resolve(root, "world"), { recursive: true })
  const config = loadConfig({
    KILN_RELAY_DATA_DIR: directory,
    KILN_RELAY_HOST: "relay.test",
    NODE_ENV: "development",
  })
  return {
    directory,
    driver: new FilesystemDriver(config),
    instance: testInstance(),
    root,
  }
}

async function* chunks(value: string): AsyncIterable<Uint8Array> {
  yield Buffer.from(value)
}

function testInstance(): RelayInstanceConfig {
  return {
    connectAddress: "localhost",
    directory: "instance-1",
    game: "Minecraft",
    id: "instance-1",
    implementation: "Paper",
    javaVersion: "21",
    managedByRelay: true,
    name: "Test Instance",
    service: "test",
    shortId: "instance",
    version: "1.21.11",
  }
}
