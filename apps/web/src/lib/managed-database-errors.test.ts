import { describe, expect, it } from "vite-plus/test"

import { isManagedDatabaseNotFoundError } from "./managed-database-errors"

describe("managed database Relay errors", () => {
  it("only treats an exact database not-found response as idempotent", () => {
    expect(
      isManagedDatabaseNotFoundError(new Error("Database not found"))
    ).toBe(true)
    expect(isManagedDatabaseNotFoundError(new Error("Relay not found"))).toBe(
      false
    )
    expect(
      isManagedDatabaseNotFoundError(
        new Error("Database not found while deleting volume")
      )
    ).toBe(false)
    expect(isManagedDatabaseNotFoundError("Database not found")).toBe(false)
  })
})
