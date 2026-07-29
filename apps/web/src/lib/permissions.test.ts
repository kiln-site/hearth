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
