import { afterEach, describe, expect, it, vi } from "vitest"

import { cacheConnectionConfig } from "./cache-config"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("cacheConnectionConfig", () => {
  it("disables the cache when no host is configured", () => {
    vi.stubEnv("CACHE_HOST", "")
    expect(cacheConnectionConfig()).toBeNull()
  })

  it("defaults the port, database, and TLS mode", () => {
    stubDatabaseEnvironment()
    vi.stubEnv("CACHE_HOST", "cache.example.com")
    expect(cacheConnectionConfig()).toEqual(
      expect.objectContaining({
        database: 0,
        host: "cache.example.com",
        password: undefined,
        port: 6379,
        tls: false,
        username: undefined,
      })
    )
    expect(cacheConnectionConfig()?.namespace).toMatch(
      /^kiln:hearth:v1:[a-f0-9]{16}$/u
    )
  })

  it("accepts split connection fields", () => {
    stubDatabaseEnvironment()
    vi.stubEnv("CACHE_HOST", "cache.example.com")
    vi.stubEnv("CACHE_PORT", "6380")
    vi.stubEnv("CACHE_USERNAME", "kiln")
    vi.stubEnv("CACHE_PASSWORD", "secret")
    vi.stubEnv("CACHE_DATABASE", "2")
    vi.stubEnv("CACHE_TLS", "true")
    expect(cacheConnectionConfig()).toEqual(
      expect.objectContaining({
        database: 2,
        host: "cache.example.com",
        password: "secret",
        port: 6380,
        tls: true,
        username: "kiln",
      })
    )
  })

  it.each([
    ["CACHE_PORT", "0", /CACHE_PORT/u],
    ["CACHE_PORT", "not-a-port", /CACHE_PORT/u],
    ["CACHE_DATABASE", "16", /CACHE_DATABASE/u],
    ["CACHE_TLS", "sometimes", /CACHE_TLS/u],
  ])("rejects invalid %s values", (name, value, expected) => {
    stubDatabaseEnvironment()
    vi.stubEnv("CACHE_HOST", "cache.example.com")
    vi.stubEnv(name, value)
    expect(() => cacheConnectionConfig()).toThrow(expected)
  })
})

function stubDatabaseEnvironment(): void {
  vi.stubEnv("DB_HOST", "mysql")
  vi.stubEnv("DB_PORT", "")
  vi.stubEnv("DB_NAME", "hearth")
  vi.stubEnv("DB_USERNAME", "kiln")
  vi.stubEnv("DB_PASSWORD", "secret")
  vi.stubEnv("DB_TABLE_PREFIX", "kiln_")
}
