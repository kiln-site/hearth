import { describe, expect, it } from "vite-plus/test"

import { platformRoleHasPermission } from "@/lib/permissions"

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
