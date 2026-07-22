import { createHash, randomUUID, sign } from "node:crypto"
import { createServerFn } from "@tanstack/react-start"
import { relayIdSchema } from "@workspace/contracts"
import { z } from "zod"

import { requireRelayPermission } from "@/lib/access-control"
import { kilnPublicUrl } from "@/lib/environment"
import { listPersistedRelays, loadRelayCredentials } from "@/lib/relay-registry"
import { requireAuthenticatedUser } from "@/server/auth"

const browserCapabilityInputSchema = z.object({
  instanceId: z.string().min(1).max(64),
  publicKeyJwk: z.object({
    crv: z.literal("P-256"),
    kty: z.literal("EC"),
    x: z.string().min(40).max(64),
    y: z.string().min(40).max(64),
  }),
  relayId: relayIdSchema,
  write: z.boolean().optional().default(false),
})

const fileCapabilityInputSchema = browserCapabilityInputSchema.extend({
  action: z.enum(["instance.files.download", "instance.files.upload"]),
  path: z
    .string()
    .min(1)
    .max(2_048)
    .refine(
      (path) =>
        !path.includes("\0") &&
        !path.startsWith("/") &&
        !path.split(/[\\/]/u).includes(".."),
      "Invalid relative file path"
    ),
})

export const issueConsoleCapability = createServerFn({ method: "POST" })
  .validator(browserCapabilityInputSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const relay = (await listPersistedRelays()).find(
      (item) => item.enabled && item.id === data.relayId
    )
    if (!relay) throw new Error("Relay is not available")
    await requireRelayPermission({
      instanceId: data.instanceId,
      permission: "instance.console.read",
      relayId: relay.id,
      user,
    })
    if (data.write) {
      await requireRelayPermission({
        instanceId: data.instanceId,
        permission: "instance.console.write",
        relayId: relay.id,
        user,
      })
    }
    return createBrowserCapability({
      actions: data.write
        ? ["instance.console.read", "instance.console.write"]
        : ["instance.console.read"],
      instanceId: data.instanceId,
      path: null,
      publicKeyJwk: data.publicKeyJwk,
      relay,
      subject: user.id,
    })
  })

export const issueResourceCapability = createServerFn({ method: "POST" })
  .validator(browserCapabilityInputSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const relay = (await listPersistedRelays()).find(
      (item) => item.enabled && item.id === data.relayId
    )
    if (!relay) throw new Error("Relay is not available")
    await requireRelayPermission({
      instanceId: data.instanceId,
      permission: "instance.read",
      relayId: relay.id,
      user,
    })
    return createBrowserCapability({
      actions: ["instance.read"],
      instanceId: data.instanceId,
      path: null,
      publicKeyJwk: data.publicKeyJwk,
      relay,
      subject: user.id,
    })
  })

export const issueFileCapability = createServerFn({ method: "POST" })
  .validator(fileCapabilityInputSchema)
  .handler(async ({ data }) => {
    const user = await requireAuthenticatedUser()
    const relay = (await listPersistedRelays()).find(
      (item) => item.enabled && item.id === data.relayId
    )
    if (!relay) throw new Error("Relay is not available")
    await requireRelayPermission({
      instanceId: data.instanceId,
      permission:
        data.action === "instance.files.upload"
          ? "instance.files.write"
          : "instance.files.read",
      relayId: relay.id,
      user,
    })
    return createBrowserCapability({
      actions: [data.action],
      instanceId: data.instanceId,
      path: data.path,
      publicKeyJwk: data.publicKeyJwk,
      relay,
      subject: user.id,
    })
  })

async function createBrowserCapability(input: {
  actions: ReadonlyArray<
    | "instance.console.read"
    | "instance.console.write"
    | "instance.read"
    | "instance.files.download"
    | "instance.files.upload"
  >
  instanceId: string
  path: string | null
  publicKeyJwk: { crv: "P-256"; kty: "EC"; x: string; y: string }
  relay: Awaited<ReturnType<typeof listPersistedRelays>>[number]
  subject: string
}) {
  const credentials = await loadRelayCredentials(input.relay.id)
  const now = Date.now()
  const payload = {
    actions: input.actions,
    audience: input.relay.id,
    capabilityId: randomUUID(),
    expiresAt: now + 60_000,
    instanceId: input.instanceId,
    issuedAt: now,
    issuer: credentials.clientId,
    keyThumbprint: browserKeyThumbprint(input.publicKeyJwk),
    origin: kilnPublicUrl().origin,
    path: input.path,
    subject: input.subject,
    version: 1,
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signature = sign(
    null,
    Buffer.from(encoded),
    credentials.clientPrivateKeyPem
  ).toString("base64url")
  return {
    browserOrigin: input.relay.browserOrigin,
    capability: `${encoded}.${signature}`,
    expiresAt: payload.expiresAt,
    relayId: input.relay.id,
  }
}

function browserKeyThumbprint(jwk: {
  crv: "P-256"
  kty: "EC"
  x: string
  y: string
}): string {
  return createHash("sha256")
    .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))
    .digest("base64url")
}
