import { z } from "zod"

export const relayObservedStateSchema = z.enum([
  "offline",
  "provisioning",
  "starting",
  "running",
  "stopping",
  "failed",
])

export const relayDesiredStateSchema = z.enum(["stopped", "running"])

export const brickIdSchema = z.enum(["paper", "folia", "fabric", "velocity"])

export const brickSchema = z.object({
  id: brickIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  image: z.string().min(1),
  proxy: z.boolean(),
  defaultVersion: z.string().min(1),
  defaultMemory: z.string().regex(/^\d+[MG]$/u),
  javaVersion: z.string().min(1),
})

export const relayCreateInstanceSchema = z.object({
  brickId: brickIdSchema,
  version: z.string().trim().min(1).max(32),
  memory: z
    .string()
    .trim()
    .regex(/^\d+[MG]$/u),
  start: z.boolean().default(true),
})

export const relayNetworkingSchema = z.object({
  enabled: z.boolean(),
  domain: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(
      /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/u
    ),
  address: z.union([z.ipv4(), z.ipv6()]),
  dnsPort: z.number().int().min(1).max(65_535).default(53),
  proxyPort: z.number().int().min(1).max(65_535).default(25_565),
})

export const relayInstanceResourcesSchema = z.object({
  sampledAt: z.string().datetime(),
  cpu: z.object({
    percent: z.number().nonnegative(),
  }),
  memory: z.object({
    totalBytes: z.number().nonnegative(),
    usedBytes: z.number().nonnegative(),
    percent: z.number().nonnegative(),
  }),
  storage: z.object({
    totalBytes: z.number().nonnegative(),
    usedBytes: z.number().nonnegative(),
    percent: z.number().nonnegative(),
  }),
  network: z
    .object({
      receivedBytes: z.number().nonnegative(),
      sentBytes: z.number().nonnegative(),
      receivedBytesPerSecond: z.number().nonnegative(),
      sentBytesPerSecond: z.number().nonnegative(),
    })
    .optional(),
})

export const relayInstanceSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{40}$/u),
  shortId: z.string().regex(/^[a-f0-9]{8}$/u),
  name: z.string().min(1),
  game: z.string().min(1),
  implementation: z.string().min(1),
  version: z.string().min(1),
  javaVersion: z.string().min(1),
  connectAddress: z.string().min(1),
  service: z.string().min(1),
  directory: z.string().min(1),
  desiredState: relayDesiredStateSchema,
  observedState: relayObservedStateSchema,
  startedAt: z.string().datetime().nullable().default(null),
  containerId: z.string().nullable(),
  status: z.string(),
  brickId: brickIdSchema.optional(),
  managedByRelay: z.boolean().default(false),
  resources: relayInstanceResourcesSchema.nullable().default(null),
})

export const relayNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  uptimeSeconds: z.number().nonnegative(),
  cpu: z.object({
    cores: z.number().int().positive(),
    loadPercent: z.number().min(0),
  }),
  memory: z.object({
    totalBytes: z.number().nonnegative(),
    usedBytes: z.number().nonnegative(),
  }),
  storage: z.object({
    totalBytes: z.number().nonnegative(),
    usedBytes: z.number().nonnegative(),
  }),
  docker: z.object({
    available: z.boolean(),
    version: z.string().nullable(),
  }),
  connectedAt: z.string().datetime(),
})

export const relaySnapshotSchema = z.object({
  node: relayNodeSchema,
  instances: z.array(relayInstanceSchema),
})

export const relayFileTreeSchema = z.object({
  instanceId: z.string(),
  paths: z.array(z.string()),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
})

export const relayFileContentSchema = z.object({
  instanceId: z.string(),
  path: z.string(),
  content: z.string(),
  size: z.number().int().nonnegative(),
  decodedSize: z.number().int().nonnegative(),
  encoding: z.enum(["utf8", "gzip"]),
  readOnly: z.boolean(),
  modifiedAt: z.string().datetime(),
})

export const relaySaveFileInputSchema = z.object({
  content: z.string().max(2 * 1024 * 1024),
  expectedModifiedAt: z.string().datetime().optional(),
})

export const relayInstanceActionSchema = z.object({
  action: z.enum(["start", "stop", "restart", "kill"]),
})

export const relayConsoleLevelSchema = z.enum([
  "info",
  "warn",
  "error",
  "debug",
  "trace",
])

export const relayConsoleLineSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().datetime().nullable(),
  level: relayConsoleLevelSchema,
  text: z.string(),
})

export const relayConsoleSchema = z.object({
  instanceId: z.string().min(1),
  lines: z.array(relayConsoleLineSchema),
  truncated: z.boolean(),
})

export const relayConsoleStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ready"),
    instanceId: z.string().min(1),
  }),
  z.object({
    type: z.literal("line"),
    line: relayConsoleLineSchema,
  }),
])

export const relayConsoleCommandSchema = z.object({
  command: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .refine((value) => !/[\r\n]/u.test(value), "Command must be one line"),
})

export const relayConsoleCommandResultSchema = z.object({
  accepted: z.literal(true),
  command: z.string(),
})

export const relayConsoleCompletionInputSchema = z
  .object({
    input: z
      .string()
      .max(512)
      .refine(
        (value) =>
          Array.from(value).every((character) => {
            const codePoint = character.charCodeAt(0)
            return codePoint >= 32 && codePoint !== 127
          }),
        "Command cannot contain control characters"
      ),
    cursor: z.number().int().min(0).max(512),
  })
  .refine(({ cursor, input }) => cursor <= input.length, {
    message: "Cursor must be within the command",
    path: ["cursor"],
  })

export const relayConsoleCompletionSchema = z.object({
  instanceId: z.string().min(1),
  supported: z.boolean(),
  completedPrefix: z.string().nullable(),
  suggestions: z.array(z.string()).max(100),
})

export const relayLatestLogSchema = z.object({
  instanceId: z.string().min(1),
  path: z.literal("logs/latest.log"),
  content: z.string(),
  size: z.number().int().nonnegative(),
})

export const relayErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
})

export const relayCatalogSchema = z.object({ bricks: z.array(brickSchema) })

export type RelayDesiredState = z.infer<typeof relayDesiredStateSchema>
export type BrickId = z.infer<typeof brickIdSchema>
export type Brick = z.infer<typeof brickSchema>
export type RelayCreateInstance = z.infer<typeof relayCreateInstanceSchema>
export type RelayNetworking = z.infer<typeof relayNetworkingSchema>
export type RelayObservedState = z.infer<typeof relayObservedStateSchema>
export type RelayInstanceResources = z.infer<
  typeof relayInstanceResourcesSchema
>
export type RelayInstance = z.infer<typeof relayInstanceSchema>
export type RelayNode = z.infer<typeof relayNodeSchema>
export type RelaySnapshot = z.infer<typeof relaySnapshotSchema>
export type RelayFileTree = z.infer<typeof relayFileTreeSchema>
export type RelayFileContent = z.infer<typeof relayFileContentSchema>
export type RelaySaveFileInput = z.infer<typeof relaySaveFileInputSchema>
export type RelayInstanceAction = z.infer<typeof relayInstanceActionSchema>
export type RelayConsoleLevel = z.infer<typeof relayConsoleLevelSchema>
export type RelayConsoleLine = z.infer<typeof relayConsoleLineSchema>
export type RelayConsole = z.infer<typeof relayConsoleSchema>
export type RelayConsoleStreamEvent = z.infer<
  typeof relayConsoleStreamEventSchema
>
export type RelayConsoleCommand = z.infer<typeof relayConsoleCommandSchema>
export type RelayConsoleCompletionInput = z.infer<
  typeof relayConsoleCompletionInputSchema
>
export type RelayConsoleCompletion = z.infer<
  typeof relayConsoleCompletionSchema
>
export type RelayLatestLog = z.infer<typeof relayLatestLogSchema>
