import { z } from "zod"

export const cliAccessModes = ["full_access", "read_only"] as const
export const cliAccessModeSchema = z.enum(cliAccessModes)

export const cliAccessDurations = [
  "1h",
  "1d",
  "1w",
  "30d",
  "indefinite",
] as const
export const cliAccessDurationSchema = z.enum(cliAccessDurations)

export const cliDeviceCodeRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
  })
  .strict()

export const cliDeviceCodeResponseSchema = z
  .object({
    deviceCode: z.string().min(32).max(256),
    expiresAt: z.iso.datetime(),
    interval: z.number().int().min(2).max(30),
    userCode: z.string().regex(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/u),
    verificationUri: z.url(),
    verificationUriComplete: z.url(),
  })
  .strict()

export const cliDeviceTokenRequestSchema = z
  .object({
    deviceCode: z.string().min(32).max(256),
  })
  .strict()

export const cliDeviceTokenResponseSchema = z
  .object({
    accessToken: z.string().startsWith("kiln_cli_"),
    credential: z.object({
      expiresAt: z.iso.datetime().nullable(),
      id: z.uuid(),
      mode: cliAccessModeSchema,
      name: z.string().min(1).max(120),
    }),
    tokenType: z.literal("Bearer"),
  })
  .strict()

export const cliErrorCodes = [
  "access_denied",
  "authentication_required",
  "authorization_pending",
  "conflict",
  "expired_token",
  "forbidden",
  "invalid_grant",
  "invalid_request",
  "not_found",
  "rate_limited",
  "relay_unavailable",
  "sftp_unavailable",
  "slow_down",
  "unexpected_error",
] as const
export const cliErrorCodeSchema = z.enum(cliErrorCodes)

export const cliErrorResponseSchema = z
  .object({
    error: z.object({
      code: cliErrorCodeSchema,
      message: z.string().min(1),
      retryable: z.boolean(),
    }),
  })
  .strict()

export const cliServerReferenceSchema = z
  .string()
  .regex(/^[A-Za-z\d_-]{43}:[a-f\d]{40}$/u)

export const cliServerSchema = z
  .object({
    id: cliServerReferenceSchema,
    instanceId: z.string().regex(/^[a-f\d]{40}$/u),
    name: z.string().min(1).max(120),
    relayId: z.string().regex(/^[A-Za-z\d_-]{43}$/u),
    relayName: z.string().min(1).max(120),
    shortId: z.string().min(1).max(40),
    state: z.string().min(1).max(64),
  })
  .strict()

export const cliServersResponseSchema = z
  .object({ servers: z.array(cliServerSchema) })
  .strict()

export const cliTargetSchema = z
  .object({
    instanceId: z.string().regex(/^[a-f\d]{40}$/u),
    relayId: z.string().regex(/^[A-Za-z\d_-]{43}$/u),
  })
  .strict()

export const cliPowerRequestSchema = cliTargetSchema
  .extend({ action: z.enum(["start", "stop", "restart", "kill"]) })
  .strict()

export const cliConsoleRequestSchema = cliTargetSchema
  .extend({
    command: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .refine((value) => !/[\r\n]/u.test(value), "Command must be one line"),
  })
  .strict()

export const cliFileTargetSchema = cliTargetSchema
  .extend({
    path: z
      .string()
      .min(1)
      .max(2_048)
      .refine(
        (path) =>
          !path.includes("\0") &&
          !path.startsWith("/") &&
          !path.split(/[\\/]/u).includes(".."),
        "Path must be relative to the server root"
      ),
  })
  .strict()

export const cliFileWriteRequestSchema = cliFileTargetSchema
  .extend({
    content: z.string().max(16 * 1024 * 1024),
    expectedModifiedAt: z.number().nonnegative().nullable().optional(),
  })
  .strict()

export const cliSftpResponseSchema = z
  .object({
    host: z.string().min(1).max(253),
    hostKeyFingerprint: z.string().startsWith("SHA256:"),
    port: z.number().int().min(1).max(65_535),
    root: z.string().startsWith("/"),
    username: z.email(),
  })
  .strict()

export type CliAccessDuration = z.infer<typeof cliAccessDurationSchema>
export type CliAccessMode = z.infer<typeof cliAccessModeSchema>
export type CliDeviceCodeResponse = z.infer<typeof cliDeviceCodeResponseSchema>
export type CliDeviceTokenResponse = z.infer<
  typeof cliDeviceTokenResponseSchema
>
export type CliErrorCode = z.infer<typeof cliErrorCodeSchema>
export type CliServer = z.infer<typeof cliServerSchema>
export type CliSftpResponse = z.infer<typeof cliSftpResponseSchema>
