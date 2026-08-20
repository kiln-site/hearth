import { Effect } from "effect"
import { describe, expect, it } from "vite-plus/test"

import {
  cliPlatformRole,
  cliRelaySubject,
  requireCliWrite,
  type CliPrincipal,
} from "@/effect/cli-access"

const principal: CliPrincipal = {
  credentialId: "12345678-1234-4123-8123-123456789abc",
  mode: "full_access",
  user: {
    email: "agent@example.test",
    emailVerified: true,
    id: "user-123",
    isDevelopmentBypass: false,
    name: "Agent",
    role: "user",
    twoFactorEnabled: false,
  },
}

describe("CLI access enforcement", () => {
  it("allows mutations for full-access credentials", async () => {
    await expect(Effect.runPromise(requireCliWrite(principal))).resolves.toBe(
      undefined
    )
  })

  it("blocks mutations for read-only credentials with a typed error", async () => {
    const error = await Effect.runPromise(
      requireCliWrite({ ...principal, mode: "read_only" }).pipe(Effect.flip)
    )

    expect(error).toMatchObject({
      _tag: "CliAccessError",
      code: "forbidden",
      retryable: false,
    })
  })

  it("encodes both the credential and owning user in Relay attribution", () => {
    expect(cliRelaySubject(principal)).toBe(
      "cli/12345678-1234-4123-8123-123456789abc/user-123"
    )
  })

  it("preserves Bring Your Own Relays authorization", () => {
    expect(cliPlatformRole("relay_creator")).toBe("relay_creator")
    expect(cliPlatformRole("unexpected-role")).toBe("user")
  })
})
