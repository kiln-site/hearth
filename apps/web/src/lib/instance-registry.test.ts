import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

vi.hoisted(() => {
  process.env.DB_HOST ??= "127.0.0.1"
  process.env.DB_NAME ??= "test"
  process.env.DB_PASSWORD ??= "test"
  process.env.DB_USERNAME ??= "test"
})

const database = vi.hoisted(() => {
  const connection = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    execute: vi.fn(
      async (_sql: string, _parameters?: ReadonlyArray<unknown>) => [[], []]
    ),
    release: vi.fn(),
    rollback: vi.fn(async () => undefined),
  }
  return {
    connection,
    getConnection: vi.fn(async () => connection),
  }
})

vi.mock("@/lib/database", () => ({
  databasePool: {
    getConnection: database.getConnection,
  },
}))

import { syncInstanceRegistry } from "@/lib/instance-registry"

describe("instance registry sync", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("does not write non-unique Relay names into the registry key", async () => {
    await syncInstanceRegistry("relay-one", [
      { id: "instance-one", name: "Survival" },
      { id: "instance-two", name: "Survival" },
    ])

    const [insertSql, insertParameters] =
      database.connection.execute.mock.calls[0] ?? []
    expect(insertSql).toContain("(relay_id, instance_id, display_name)")
    expect(insertSql).toContain("(?, ?, NULL), (?, ?, NULL)")
    expect(insertSql).not.toContain("display_name = VALUES(display_name)")
    expect(insertParameters).toEqual([
      "relay-one",
      "instance-one",
      "relay-one",
      "instance-two",
    ])
  })
})
