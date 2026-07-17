import { afterEach, describe, expect, it, vi } from "vitest"

import { cacheConnectionConfig } from "./cache-config"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("cacheConnectionConfig", () => {
  it("disables the cache when no URL is configured", () => {
    vi.stubEnv("KILN_CACHE_URL", "")
    expect(cacheConnectionConfig()).toBeNull()
  })

  it("accepts Redis-protocol URLs and an explicit namespace", () => {
    vi.stubEnv("KILN_CACHE_URL", "rediss://cache.example.com:6380/2")
    vi.stubEnv("KILN_CACHE_NAMESPACE", "kiln:test")
    const config = cacheConnectionConfig()
    expect(config?.namespace).toBe("kiln:test")
    expect(config?.url.href).toBe("rediss://cache.example.com:6380/2")
  })

  it.each([
    "https://cache.example.com",
    "redis:///0",
    "redis://cache.example.com/16",
    "redis://cache.example.com/0?tls=true",
  ])("rejects invalid cache URL %s", (url) => {
    vi.stubEnv("KILN_CACHE_URL", url)
    vi.stubEnv("KILN_CACHE_NAMESPACE", "kiln:test")
    expect(() => cacheConnectionConfig()).toThrow(/KILN_CACHE_URL/u)
  })
})
