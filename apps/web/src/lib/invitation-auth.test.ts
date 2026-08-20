import { describe, expect, it } from "vite-plus/test"

import {
  invitationDestination,
  invitePath,
  inviteTokenFromRedirect,
} from "@/lib/invitation-auth"

describe("invitation auth helpers", () => {
  it("builds and parses invite redirect paths", () => {
    const token = "a".repeat(32)
    const path = invitePath(token)
    expect(path).toBe(`/invite?token=${token}`)
    expect(inviteTokenFromRedirect(path)).toBe(token)
    expect(inviteTokenFromRedirect(`/?redirect=${path}`)).toBeNull()
    expect(inviteTokenFromRedirect("/invite?token=short")).toBeNull()
    expect(inviteTokenFromRedirect("/invite?://")).toBeNull()
  })

  it("sends accepted invitations to the invited resource", () => {
    expect(
      invitationDestination({
        accessType: "platform_admin",
        databaseId: null,
        instanceId: null,
      })
    ).toBe("/infra/relays")
    expect(
      invitationDestination({
        accessType: "relay_creator",
        databaseId: null,
        instanceId: null,
      })
    ).toBe("/infra/relays")
    expect(
      invitationDestination({
        accessType: "scoped",
        databaseId: null,
        instanceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      })
    ).toBe("/server/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/console")
    expect(
      invitationDestination({
        accessType: "scoped",
        databaseId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        instanceId: null,
      })
    ).toBe("/infra/databases?search=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
    expect(
      invitationDestination({
        accessType: "scoped",
        databaseId: null,
        instanceId: null,
      })
    ).toBe("/infra/servers")
  })
})
