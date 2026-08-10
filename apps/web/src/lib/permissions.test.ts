import { describe, expect, it } from "vite-plus/test"

import { platformRoleHasPermission, roleHasPermission } from "@/lib/permissions"

describe("platform appearance permissions", () => {
  it("reserves appearance defaults for platform administrators", () => {
    expect(
      platformRoleHasPermission("admin", "platform.appearance.manage-default")
    ).toBe(true)
    expect(
      platformRoleHasPermission("user", "platform.appearance.manage-default")
    ).toBe(false)
  })
})

describe("server deletion permissions", () => {
  it("allows owners and administrators to delete servers", () => {
    expect(roleHasPermission("owner", "instance.delete")).toBe(true)
    expect(roleHasPermission("admin", "instance.delete")).toBe(true)
  })

  it("does not allow operators or viewers to delete servers", () => {
    expect(roleHasPermission("operator", "instance.delete")).toBe(false)
    expect(roleHasPermission("viewer", "instance.delete")).toBe(false)
  })
})

describe("backup permissions", () => {
  it("allows operators to manage backups without granting server deletion", () => {
    expect(roleHasPermission("operator", "backup.create")).toBe(true)
    expect(roleHasPermission("operator", "backup.restore")).toBe(true)
    expect(roleHasPermission("operator", "backup.delete")).toBe(true)
    expect(roleHasPermission("operator", "instance.delete")).toBe(false)
  })

  it("limits viewers to reading and downloading existing backups", () => {
    expect(roleHasPermission("viewer", "backup.read")).toBe(true)
    expect(roleHasPermission("viewer", "backup.download")).toBe(true)
    expect(roleHasPermission("viewer", "backup.create")).toBe(false)
    expect(roleHasPermission("viewer", "backup.restore")).toBe(false)
    expect(roleHasPermission("viewer", "backup.delete")).toBe(false)
  })

  it("reserves platform destinations and caps for platform administrators", () => {
    expect(
      platformRoleHasPermission("admin", "platform.backups.manage-storage")
    ).toBe(true)
    expect(
      platformRoleHasPermission("admin", "platform.backups.manage-limits")
    ).toBe(true)
    expect(
      platformRoleHasPermission("user", "platform.backups.manage-storage")
    ).toBe(false)
    expect(
      platformRoleHasPermission("user", "platform.backups.manage-limits")
    ).toBe(false)
  })
})
