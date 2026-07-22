import { createServerFn } from "@tanstack/react-start"
import { relayIdSchema } from "@workspace/contracts"
import { z } from "zod"

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
    const [{ requireAuthenticatedUser }, { issueConsoleCapabilityForUser }] =
      await Promise.all([
        import("@/server/auth"),
        import("@/server/relay-capability-service"),
      ])
    const user = await requireAuthenticatedUser()
    return issueConsoleCapabilityForUser({
      instanceId: data.instanceId,
      publicKeyJwk: data.publicKeyJwk,
      relayId: data.relayId,
      user,
      write: data.write,
    })
  })

export const issueResourceCapability = createServerFn({ method: "POST" })
  .validator(browserCapabilityInputSchema)
  .handler(async ({ data }) => {
    const [{ requireAuthenticatedUser }, { issueResourceCapabilityForUser }] =
      await Promise.all([
        import("@/server/auth"),
        import("@/server/relay-capability-service"),
      ])
    const user = await requireAuthenticatedUser()
    return issueResourceCapabilityForUser({
      instanceId: data.instanceId,
      publicKeyJwk: data.publicKeyJwk,
      relayId: data.relayId,
      user,
    })
  })

export const issueFileCapability = createServerFn({ method: "POST" })
  .validator(fileCapabilityInputSchema)
  .handler(async ({ data }) => {
    const [{ requireAuthenticatedUser }, { issueFileCapabilityForUser }] =
      await Promise.all([
        import("@/server/auth"),
        import("@/server/relay-capability-service"),
      ])
    const user = await requireAuthenticatedUser()
    return issueFileCapabilityForUser({
      action: data.action,
      instanceId: data.instanceId,
      path: data.path,
      publicKeyJwk: data.publicKeyJwk,
      relayId: data.relayId,
      user,
    })
  })
