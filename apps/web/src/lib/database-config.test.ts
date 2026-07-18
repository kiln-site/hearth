import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { databaseConnectionConfig } from "./database-config"

beforeEach(() => {
  vi.stubEnv("DB_HOST", "mysql")
  vi.stubEnv("DB_NAME", "hearth")
  vi.stubEnv("DB_USERNAME", "kiln")
  vi.stubEnv("DB_PASSWORD", "secret")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("databaseConnectionConfig", () => {
  it("defaults the MySQL port when it is not configured", () => {
    vi.stubEnv("DB_PORT", "")
    expect(databaseConnectionConfig().port).toBe(3306)
  })

  it("uses an explicitly configured MySQL port", () => {
    vi.stubEnv("DB_PORT", "3307")
    expect(databaseConnectionConfig().port).toBe(3307)
  })

  it.each(["0", "65536", "not-a-port"])(
    "rejects invalid MySQL port %s",
    (port) => {
      vi.stubEnv("DB_PORT", port)
      expect(() => databaseConnectionConfig()).toThrow(/DB_PORT/u)
    }
  )
})
