import { createHash } from "node:crypto"

import {
  databaseConnectionConfig,
  databaseTablePrefix,
} from "./database-config"

export interface CacheConnectionConfig {
  database: number
  host: string
  namespace: string
  password: string | undefined
  port: number
  tls: boolean
  username: string | undefined
}

export function cacheConnectionConfig(): CacheConnectionConfig | null {
  const host = process.env.CACHE_HOST?.trim()
  if (!host) return null

  return {
    database: cacheDatabase(process.env.CACHE_DATABASE),
    host,
    namespace: defaultCacheNamespace(),
    password: process.env.CACHE_PASSWORD || undefined,
    port: cachePort(process.env.CACHE_PORT),
    tls: cacheTls(process.env.CACHE_TLS),
    username: process.env.CACHE_USERNAME?.trim() || undefined,
  }
}

function cachePort(value: string | undefined): number {
  const port = Number(value?.trim() || 6379)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("CACHE_PORT must be a valid TCP port")
  }
  return port
}

function cacheDatabase(value: string | undefined): number {
  const database = Number(value?.trim() || 0)
  if (!Number.isInteger(database) || database < 0 || database > 15) {
    throw new Error("CACHE_DATABASE must be between 0 and 15")
  }
  return database
}

function cacheTls(value: string | undefined): boolean {
  const configured = value?.trim()
  if (!configured) return false
  if (/^(?:1|true|yes|on)$/iu.test(configured)) return true
  if (/^(?:0|false|no|off)$/iu.test(configured)) return false
  throw new Error("CACHE_TLS must be true or false")
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
