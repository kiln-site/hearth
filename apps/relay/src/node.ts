import {
  arch,
  cpus,
  freemem,
  hostname,
  loadavg,
  platform,
  totalmem,
  uptime,
} from "node:os"
import { statfs } from "node:fs/promises"

import type { RelayNode } from "@workspace/contracts"

import type { RelayConfig } from "./config.js"
import type { DockerDriver } from "./docker.js"

const connectedAt = new Date().toISOString()
const relayVersion = buildVersion()

export async function nodeSnapshot(
  config: RelayConfig,
  docker: DockerDriver
): Promise<RelayNode> {
  const filesystem = await statfs(config.rootDirectory)
  const storageTotal = filesystem.blocks * filesystem.bsize
  const storageAvailable = filesystem.bavail * filesystem.bsize
  const dockerVersion = await docker.dockerVersion()
  const totalMemory = totalmem()

  return {
    id: config.nodeId,
    name: config.nodeName || hostname(),
    version: relayVersion,
    platform: platform(),
    arch: arch(),
    uptimeSeconds: uptime(),
    cpu: {
      cores: cpus().length,
      loadPercent: Math.round((loadavg()[0] / cpus().length) * 10_000) / 100,
    },
    memory: {
      totalBytes: totalMemory,
      usedBytes: totalMemory - freemem(),
    },
    storage: {
      totalBytes: storageTotal,
      usedBytes: storageTotal - storageAvailable,
    },
    docker: {
      available: dockerVersion !== null,
      version: dockerVersion,
    },
    connectedAt,
  }
}

function buildVersion(): string {
  const commit = (
    process.env.SOURCE_COMMIT ??
    process.env.SENTRY_RELEASE ??
    ""
  ).trim()
  return commit ? commit.slice(0, 8) : "development"
}
