import {
  arch,
  cpus,
  freemem,
  hostname,
  loadavg,
  platform,
  totalmem,
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
  const [dockerVersion, startedAt] = await Promise.all([
    docker.dockerVersion(),
    docker.relayStartedAt(),
  ])
  const totalMemory = totalmem()
  const startedAtTimestamp = startedAt ? Date.parse(startedAt) : Number.NaN

  return {
    id: config.nodeId,
    name: config.nodeName || hostname(),
    version: relayVersion,
    platform: platform(),
    arch: arch(),
    uptimeSeconds: Number.isFinite(startedAtTimestamp)
      ? Math.max(0, Math.floor((Date.now() - startedAtTimestamp) / 1_000))
      : null,
    startedAt,
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
