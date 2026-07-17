import { createHash } from "node:crypto"

import {
  databaseConnectionConfig,
  databaseTablePrefix,
} from "./database-config"

export interface CacheConnectionConfig {
  namespace: string
  url: URL
}

export function cacheConnectionConfig(): CacheConnectionConfig | null {
  const configured = process.env.KILN_CACHE_URL?.trim()
  if (!configured) return null

  let url: URL
  try {
    url = new URL(configured)
  } catch {
    throw new Error("KILN_CACHE_URL must be an absolute redis or rediss URL")
  }
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("KILN_CACHE_URL must use redis or rediss")
  }
  if (!url.hostname) {
    throw new Error("KILN_CACHE_URL must include a hostname")
  }
  if (url.search || url.hash) {
    throw new Error("KILN_CACHE_URL must not contain a query or fragment")
  }
  if (url.pathname !== "" && url.pathname !== "/") {
    const database = url.pathname.slice(1)
    if (!/^\d+$/u.test(database) || Number(database) > 15) {
      throw new Error("KILN_CACHE_URL database must be between 0 and 15")
    }
  }

  const namespace = process.env.KILN_CACHE_NAMESPACE?.trim()
  if (namespace && !/^[A-Za-z0-9:_-]{1,80}$/u.test(namespace)) {
    throw new Error(
      "KILN_CACHE_NAMESPACE must contain only letters, numbers, colons, underscores, or hyphens"
    )
  }

  return {
    namespace: namespace || defaultCacheNamespace(),
    url,
  }
}

function defaultCacheNamespace(): string {
  const database = databaseConnectionConfig()
  const installation = `${database.host}:${database.port}/${database.database}/${databaseTablePrefix()}`
  const digest = createHash("sha256")
    .update(installation)
    .digest("hex")
    .slice(0, 16)
  return `kiln:hearth:v1:${digest}`
}
