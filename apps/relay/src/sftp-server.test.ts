import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import ssh2 from "ssh2"
import { afterEach, describe, expect, it } from "vite-plus/test"

import type { RelayConfig, RelayInstanceConfig } from "./config.js"
import { attachSftpServer } from "./sftp-server.js"

const temporaryDirectories: Array<string> = []
const describeLinux = process.platform === "linux" ? describe : describe.skip
const allowFileAccess = async () => [
  "instance.sftp.connect",
  "instance.files.list",
  "instance.files.read",
  "instance.files.create",
  "instance.files.write",
  "instance.files.delete",
  "instance.files.rename",
  "instance.files.chmod",
]

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  )
})

describeLinux("Relay SFTP server", () => {
  it("exposes authorized instances, transfers files, and rejects SSH commands", async () => {
    const dataDirectory = await mkdtemp(resolve(tmpdir(), "kiln-sftp-test-"))
    temporaryDirectories.push(dataDirectory)
    const instanceId = "a".repeat(40)
    const rootDirectory = resolve(dataDirectory, "instances")
    const instanceDirectory = resolve(rootDirectory, instanceId)
    await mkdir(instanceDirectory, { recursive: true })
    await writeFile(resolve(instanceDirectory, "existing.txt"), "existing")
    const instance = testInstance(instanceId)
    const server = await attachSftpServer({
      clientActions: allowFileAccess,
      config: testConfig(dataDirectory),
      control: {
        requestClients: async () => [
          {
            clientId: "hearth-test",
            payload: {
              instances: [
                {
                  actions: [
                    "instance.files.list",
                    "instance.files.read",
                    "instance.files.create",
                    "instance.files.write",
                    "instance.files.delete",
                    "instance.files.rename",
                    "instance.files.chmod",
                  ],
                  id: instanceId,
                },
              ],
              userId: "user-test",
              username: "user@example.test",
            },
          },
        ],
      },
      docker: {
        findInstance: async (id) => (id === instanceId ? instance : null),
      },
    })

    const client = await connect(server.port, "dev123")
    try {
      const stream = await sftp(client)
      const roots = await sftpCall<Array<{ filename: string }>>(
        stream,
        "readdir",
        "/"
      )
      expect(roots.map((entry) => entry.filename)).toEqual([instanceId])
      const path = `/${instanceId}/round-trip.txt`
      await sftpCall(stream, "writeFile", path, Buffer.from("round trip"))
      const downloaded = await sftpCall<Buffer>(stream, "readFile", path)
      expect(downloaded.toString()).toBe("round trip")
      expect(
        await readFile(resolve(instanceDirectory, "round-trip.txt"), "utf8")
      ).toBe("round trip")
      await sftpCall(stream, "unlink", path)
      await expect(execute(client, "whoami")).rejects.toThrow()
    } finally {
      client.end()
      await server.close()
    }
  })

  it("rejects invalid development credentials", async () => {
    const dataDirectory = await mkdtemp(resolve(tmpdir(), "kiln-sftp-test-"))
    temporaryDirectories.push(dataDirectory)
    await mkdir(resolve(dataDirectory, "instances"), { recursive: true })
    const server = await attachSftpServer({
      clientActions: allowFileAccess,
      config: testConfig(dataDirectory),
      control: { requestClients: async () => [] },
      docker: { findInstance: async () => null },
    })
    try {
      await expect(connect(server.port, "wrong-password")).rejects.toThrow(
        "All configured authentication methods failed"
      )
    } finally {
      await server.close()
    }
  })

  it("rejects a Hearth without the SFTP connection action", async () => {
    const dataDirectory = await mkdtemp(resolve(tmpdir(), "kiln-sftp-test-"))
    temporaryDirectories.push(dataDirectory)
    await mkdir(resolve(dataDirectory, "instances"), { recursive: true })
    const server = await attachSftpServer({
      clientActions: async () => [
        "instance.files.list",
        "instance.files.read",
      ],
      config: testConfig(dataDirectory),
      control: {
        requestClients: async () => [
          {
            clientId: "revoked-hearth",
            payload: {
              instances: [
                {
                  actions: ["instance.files.list", "instance.files.read"],
                  id: "a".repeat(40),
                },
              ],
              userId: "user-test",
              username: "user@example.test",
            },
          },
        ],
      },
      docker: { findInstance: async () => null },
    })
    try {
      await expect(connect(server.port, "dev123")).rejects.toThrow(
        "All configured authentication methods failed"
      )
    } finally {
      await server.close()
    }
  })

  it("intersects file operations with the paired Hearth grant", async () => {
    const dataDirectory = await mkdtemp(resolve(tmpdir(), "kiln-sftp-test-"))
    temporaryDirectories.push(dataDirectory)
    const instanceId = "b".repeat(40)
    const instanceDirectory = resolve(dataDirectory, "instances", instanceId)
    await mkdir(instanceDirectory, { recursive: true })
    await writeFile(resolve(instanceDirectory, "readable.txt"), "read only")
    const server = await attachSftpServer({
      clientActions: async () => [
        "instance.sftp.connect",
        "instance.files.list",
        "instance.files.read",
      ],
      config: testConfig(dataDirectory),
      control: {
        requestClients: async () => [
          {
            clientId: "read-only-hearth",
            payload: {
              instances: [
                {
                  actions: [
                    "instance.files.list",
                    "instance.files.read",
                    "instance.files.create",
                    "instance.files.write",
                  ],
                  id: instanceId,
                },
              ],
              userId: "user-test",
              username: "user@example.test",
            },
          },
        ],
      },
      docker: {
        findInstance: async (id) =>
          id === instanceId ? testInstance(instanceId) : null,
      },
    })
    const client = await connect(server.port, "dev123")
    try {
      const stream = await sftp(client)
      const readable = await sftpCall<Buffer>(
        stream,
        "readFile",
        `/${instanceId}/readable.txt`
      )
      expect(readable.toString()).toBe("read only")
      await expect(
        sftpCall(
          stream,
          "writeFile",
          `/${instanceId}/forbidden.txt`,
          Buffer.from("no")
        )
      ).rejects.toThrow()
    } finally {
      client.end()
      await server.close()
    }
  })

  it("rejects an email claimed by more than one connected Hearth", async () => {
    const dataDirectory = await mkdtemp(resolve(tmpdir(), "kiln-sftp-test-"))
    temporaryDirectories.push(dataDirectory)
    await mkdir(resolve(dataDirectory, "instances"), { recursive: true })
    const authorization = {
      instances: [
        {
          actions: ["instance.files.list", "instance.files.read"],
          id: "a".repeat(40),
        },
      ],
      userId: "user-test",
      username: "user@example.test",
    }
    const server = await attachSftpServer({
      clientActions: allowFileAccess,
      config: testConfig(dataDirectory),
      control: {
        requestClients: async () => [
          { clientId: "hearth-one", payload: authorization },
          { clientId: "hearth-two", payload: authorization },
        ],
      },
      docker: { findInstance: async () => null },
    })
    try {
      await expect(connect(server.port, "dev123")).rejects.toThrow(
        "All configured authentication methods failed"
      )
    } finally {
      await server.close()
    }
  })

  it("persists a stable SSH host-key fingerprint", async () => {
    const dataDirectory = await mkdtemp(resolve(tmpdir(), "kiln-sftp-test-"))
    temporaryDirectories.push(dataDirectory)
    await mkdir(resolve(dataDirectory, "instances"), { recursive: true })
    const options = {
      clientActions: allowFileAccess,
      config: testConfig(dataDirectory),
      control: { requestClients: async () => [] },
      docker: { findInstance: async () => null },
    }
    const first = await attachSftpServer(options)
    const fingerprint = first.hostKeyFingerprint
    await first.close()
    const second = await attachSftpServer(options)
    try {
      expect(fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]+$/u)
      expect(second.hostKeyFingerprint).toBe(fingerprint)
    } finally {
      await second.close()
    }
  })
})

function connect(port: number, password: string): Promise<ssh2.Client> {
  const client = new ssh2.Client()
  return new Promise((resolveConnect, reject) => {
    client.once("ready", () => resolveConnect(client))
    client.once("error", reject)
    client.connect({
      host: "127.0.0.1",
      hostVerifier: () => true,
      password,
      port,
      readyTimeout: 5_000,
      username: "user@example.test",
    })
  })
}

function sftp(client: ssh2.Client): Promise<ssh2.SFTPWrapper> {
  return new Promise((resolveSftp, reject) => {
    client.sftp((cause, stream) =>
      cause ? reject(cause) : resolveSftp(stream)
    )
  })
}

function sftpCall<T = void>(
  stream: ssh2.SFTPWrapper,
  method: string,
  ...arguments_: ReadonlyArray<unknown>
): Promise<T> {
  return new Promise((resolveCall, reject) => {
    const operation = stream[method as keyof ssh2.SFTPWrapper] as Function
    operation.call(
      stream,
      ...arguments_,
      (cause: Error | undefined, value: T) =>
        cause ? reject(cause) : resolveCall(value)
    )
  })
}

function execute(client: ssh2.Client, command: string): Promise<void> {
  return new Promise((resolveExecution, reject) => {
    client.exec(command, (cause, stream) =>
      cause || !stream
        ? reject(cause ?? new Error("No stream"))
        : resolveExecution()
    )
  })
}

function testConfig(dataDirectory: string): RelayConfig {
  return {
    advertisedHost: "127.0.0.1",
    advertisedHostInferred: false,
    bootstrapToken: null,
    brickCatalogUrl: "https://example.test/catalog.yml",
    browserOrigin: "https://127.0.0.1:4100",
    composeFile: resolve(dataDirectory, "instances", "compose.yaml"),
    connectDomain: "test",
    connectPort: 25_565,
    dataDirectory,
    dockerSocket: "/var/run/docker.sock",
    host: "127.0.0.1",
    managedLabel: "kiln.relay.managed=true",
    nodeId: "test",
    nodeName: "Test Relay",
    port: 4100,
    publicPort: 4100,
    projectDirectory: resolve(dataDirectory, "instances"),
    projectName: "test",
    rootDirectory: resolve(dataDirectory, "instances"),
    serverIdLabel: "kiln.server.id",
    sftpDevAuthentication: true,
    sftpPort: 0,
    tlsCertificatePath: null,
    tlsKeyPath: null,
    tlsMode: "development",
  }
}

function testInstance(id: string): RelayInstanceConfig {
  return {
    connectAddress: "localhost",
    directory: id,
    game: "Minecraft",
    id,
    implementation: "Paper",
    javaVersion: "21",
    managedByRelay: true,
    name: "Test Instance",
    service: "test",
    shortId: id.slice(0, 8),
    version: "1.21.11",
  }
}
