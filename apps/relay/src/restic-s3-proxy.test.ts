import { once } from "node:events"
import { createServer, connect, type Socket } from "node:net"

import { describe, expect, it } from "vite-plus/test"

import {
  parseResticS3ConnectRequest,
  parseResticS3ConnectTarget,
  resticS3ProxyAllowedHosts,
  withResticS3Proxy,
} from "./restic-s3-proxy.js"

const token = "proxy-token"

describe("restic S3 CONNECT proxy", () => {
  it("allows the endpoint, virtual-hosted bucket, and AWS regional hosts", () => {
    expect(
      [
        ...resticS3ProxyAllowedHosts({
          bucket: "kiln-backups",
          endpoint: "https://s3.us-east-1.amazonaws.com",
          region: "us-east-1",
        }),
      ].sort()
    ).toEqual([
      "kiln-backups.s3.dualstack.us-east-1.amazonaws.com",
      "kiln-backups.s3.us-east-1.amazonaws.com",
      "s3.dualstack.us-east-1.amazonaws.com",
      "s3.us-east-1.amazonaws.com",
    ])
    expect(
      resticS3ProxyAllowedHosts({
        bucket: "kiln-backups",
        endpoint: "https://s3.cn-north-1.amazonaws.com.cn",
        region: "cn-north-1",
      }).has("s3.cn-north-1.amazonaws.com.cn")
    ).toBe(true)
    expect(
      resticS3ProxyAllowedHosts({
        bucket: "kiln-backups",
        endpoint: "https://minio:9000",
        region: "us-east-1",
      }).has("s3.us-east-1.amazonaws.com")
    ).toBe(false)
  })

  it("parses CONNECT targets and requires the proxy token", () => {
    expect(parseResticS3ConnectTarget("s3.example.com:443")).toEqual({
      hostname: "s3.example.com",
      port: 443,
    })
    expect(parseResticS3ConnectTarget("s3.example.com:443/evil")).toBeNull()
    expect(
      parseResticS3ConnectTarget("user:pass@s3.example.com:443")
    ).toBeNull()
    expect(parseResticS3ConnectTarget("[")).toBeNull()
    const authorized = connectRequest("s3.example.com:443", token)
    expect(
      parseResticS3ConnectRequest(authorized, { endpointPort: 443, token })
    ).toEqual({ hostname: "s3.example.com", port: 443 })
    expect(
      parseResticS3ConnectRequest(
        connectRequest("s3.example.com:443", "wrong"),
        { endpointPort: 443, token }
      )
    ).toBeNull()
    expect(
      parseResticS3ConnectRequest(authorized, { endpointPort: 9000, token })
    ).toBeNull()
  })

  it("rejects CONNECT to a host outside the allowlist", async () => {
    const status = await proxyConnect({
      allowPrivateNetwork: true,
      host: "evil.example.com",
      lookupAddress: "8.8.8.8",
      port: 443,
    })
    expect(status).toBe(403)
  })

  it("rejects private DNS answers unless allowPrivateNetwork is set", async () => {
    const denied = await proxyConnect({
      allowPrivateNetwork: false,
      host: "minio",
      lookupAddress: "10.0.0.8",
      port: 9000,
    })
    expect(denied).toBe(403)

    const upstream = await listeningServer()
    try {
      const allowed = await proxyConnect({
        allowPrivateNetwork: true,
        host: "minio",
        lookupAddress: "127.0.0.1",
        port: upstream.port,
      })
      expect(allowed).toBe(200)
    } finally {
      upstream.server.close()
    }
  })

  it("retries the next DNS address after an unreachable first answer", async () => {
    const upstream = await listeningServer()
    try {
      const status = await withResticS3Proxy(
        {
          allowPrivateNetwork: true,
          allowedHosts: new Set(["minio"]),
          connectTimeoutMs: 250,
          endpointPort: upstream.port,
          lookup: (_hostname, _options, callback) => {
            callback(null, [
              { address: "192.0.2.1", family: 4 },
              { address: "127.0.0.1", family: 4 },
            ])
          },
          token,
        },
        async (proxyUrl) => {
          const parsed = new URL(proxyUrl)
          const client = connect({
            host: parsed.hostname,
            port: Number(parsed.port),
          })
          await once(client, "connect")
          client.write(connectRequest(`minio:${upstream.port}`, token))
          const [chunk] = (await once(client, "data")) as [Buffer]
          client.destroy()
          return Number(chunk.toString("latin1").split(" ")[1])
        }
      )
      expect(status).toBe(200)
    } finally {
      upstream.server.close()
    }
  })

  it("closes clients that never finish CONNECT headers", async () => {
    let client: Socket | undefined
    await withResticS3Proxy(
      {
        allowPrivateNetwork: true,
        allowedHosts: new Set(["minio"]),
        connectTimeoutMs: 25,
        endpointPort: 9000,
        token,
      },
      async (proxyUrl) => {
        const parsed = new URL(proxyUrl)
        client = connect({
          host: parsed.hostname,
          port: Number(parsed.port),
        })
        client.on("error", () => {})
        await once(client, "connect")
        client.resume()
        await once(client, "close")
      }
    )
    expect(client?.destroyed).toBe(true)
  })

  it("closes an established tunnel when the proxy scope ends", async () => {
    const upstream = await holdingServer()
    let client: Socket | undefined
    try {
      await withResticS3Proxy(
        {
          allowPrivateNetwork: true,
          allowedHosts: new Set(["minio"]),
          connectTimeoutMs: 250,
          endpointPort: upstream.port,
          lookup: (_hostname, _options, callback) => {
            callback(null, [{ address: "127.0.0.1", family: 4 }])
          },
          token,
        },
        async (proxyUrl) => {
          const parsed = new URL(proxyUrl)
          client = connect({
            host: parsed.hostname,
            port: Number(parsed.port),
          })
          client.on("error", () => {})
          await once(client, "connect")
          client.write(connectRequest(`minio:${upstream.port}`, token))
          const [chunk] = (await once(client, "data")) as [Buffer]
          expect(Number(chunk.toString("latin1").split(" ")[1])).toBe(200)
        }
      )
      if (client && !client.destroyed) await once(client, "close")
      expect(client?.destroyed).toBe(true)
    } finally {
      upstream.server.close()
      for (const socket of upstream.sockets) socket.destroy()
    }
  })
})

function connectRequest(authority: string, proxyToken: string) {
  const expected = Buffer.from(`user:${proxyToken}`).toString("base64")
  return [
    `CONNECT ${authority} HTTP/1.1`,
    `Proxy-Authorization: Basic ${expected}`,
    "Host: 127.0.0.1",
    "",
    "",
  ].join("\r\n")
}

async function proxyConnect(input: {
  allowPrivateNetwork: boolean
  host: string
  lookupAddress: string
  port: number
}) {
  return withResticS3Proxy(
    {
      allowPrivateNetwork: input.allowPrivateNetwork,
      allowedHosts: new Set(["s3.example.com", "minio"]),
      endpointPort: input.port,
      lookup: (_hostname, _options, callback) => {
        callback(null, [
          {
            address: input.lookupAddress,
            family: 4,
          },
        ])
      },
      token,
    },
    async (proxyUrl) => {
      const parsed = new URL(proxyUrl)
      const client = connect({
        host: parsed.hostname,
        port: Number(parsed.port),
      })
      await once(client, "connect")
      client.write(connectRequest(`${input.host}:${input.port}`, token))
      const [chunk] = (await once(client, "data")) as [Buffer]
      client.destroy()
      return Number(chunk.toString("latin1").split(" ")[1])
    }
  )
}

async function listeningServer(): Promise<{
  port: number
  server: ReturnType<typeof createServer>
}> {
  const server = createServer((socket: Socket) => {
    socket.end()
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("upstream test server did not bind")
  }
  return { port: address.port, server }
}

async function holdingServer(): Promise<{
  port: number
  server: ReturnType<typeof createServer>
  sockets: Set<Socket>
}> {
  const sockets = new Set<Socket>()
  const server = createServer((socket: Socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("upstream test server did not bind")
  }
  return { port: address.port, server, sockets }
}
