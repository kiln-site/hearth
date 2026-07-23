import { z } from "zod"

export * from "./relay-protocol.js"

export const relayIdSchema = z.string().regex(/^[A-Za-z\d_-]{43}$/u)

export const relayObservedStateSchema = z.enum([
  "offline",
  "provisioning",
  "starting",
  "running",
  "stopping",
  "failed",
])

export const relayDesiredStateSchema = z.enum(["stopped", "running"])

export const brickIdSchema = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,63}$/u)

export const brickVariableValueSchema = z.union([
  z.string().max(8_192),
  z.number().finite(),
  z.boolean(),
])

export const brickVariableSchema = z
  .object({
    type: z.enum(["string", "number", "boolean"]),
    label: z.string().min(1).max(80),
    description: z.string().min(1).max(280),
    required: z.boolean(),
    sensitive: z.boolean().default(false),
    default: brickVariableValueSchema.optional(),
    options: z.array(brickVariableValueSchema).min(1).max(64).optional(),
    rules: z
      .object({
        pattern: z.string().max(512).optional(),
        min: z.number().finite().optional(),
        max: z.number().finite().optional(),
        minLength: z.number().int().min(0).max(8_192).optional(),
        maxLength: z.number().int().min(1).max(8_192).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export const brickRecipeSchema = z
  .object({
    format: z.literal("kiln.brick/v1"),
    metadata: z
      .object({
        id: brickIdSchema,
        name: z.string().min(1).max(80),
        description: z.string().min(1).max(280),
        game: z.string().min(1).max(80),
        author: z.string().min(1).max(80),
        documentation: z.url().max(2_048).optional(),
        tags: z
          .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/u))
          .max(12)
          .optional(),
      })
      .strict(),
    variables: z.record(
      z.string().regex(/^[a-z][a-z0-9_]{0,47}$/u),
      brickVariableSchema
    ),
    runtime: z
      .object({
        image: z.string().min(1).max(512),
        name: z.string().min(1).max(80),
        environment: z.record(
          z.string().regex(/^[A-Z_][A-Z0-9_]*$/u),
          z.string().max(8_192)
        ),
        entrypoint: z.array(z.string().max(2_048)).max(32).optional(),
        command: z.array(z.string().max(2_048)).max(64).optional(),
        workingDirectory: z.string().startsWith("/").max(256).optional(),
        stopSignal: z
          .string()
          .regex(/^SIG[A-Z0-9]+$/u)
          .optional(),
        user: z
          .string()
          .regex(/^[0-9]+(?::[0-9]+)?$/u)
          .optional(),
        resources: z
          .object({
            memory: z.string().min(1).max(128),
            memoryReservation: z.string().min(1).max(128).optional(),
            pids: z.number().int().min(16).max(32_768).default(512),
          })
          .strict(),
        storage: z
          .object({ mount: z.string().startsWith("/").max(256) })
          .strict(),
      })
      .strict(),
    network: z
      .object({
        mode: z.enum(["minecraft-backend", "minecraft-proxy", "direct"]),
        primaryPort: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/u),
        hostname: z.string().min(1).max(256).optional(),
        ports: z
          .array(
            z
              .object({
                name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/u),
                container: z.number().int().min(1).max(65_535),
                protocol: z.enum(["tcp", "udp"]),
                host: z.number().int().min(1).max(65_535).optional(),
              })
              .strict()
          )
          .min(1)
          .max(16),
      })
      .strict(),
    constraints: z
      .object({
        architectures: z
          .array(z.enum(["amd64", "arm64"]))
          .min(1)
          .optional(),
        singleton: z.boolean().default(false),
      })
      .strict()
      .default({ singleton: false }),
  })
  .strict()

export const brickSourceSchema = z.string().trim().url().max(2_048)

export const brickSchema = brickRecipeSchema.extend({
  source: brickSourceSchema,
})

export const relayCreateInstanceSchema = z.object({
  recipe: brickSourceSchema,
  variables: z.record(
    z.string().regex(/^[a-z][a-z0-9_]{0,47}$/u),
    brickVariableValueSchema
  ),
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

export const relayProxyModeSchema = z.enum([
  "none",
  "hearth",
  "traefik",
  "coolify",
])

export const relayProxySettingsSchema = z
  .object({
    mode: relayProxyModeSchema,
    traefikImage: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(
        /^traefik(?:@sha256:[a-f0-9]{64}|:[A-Za-z0-9._-]+)$/u,
        "Use an official pinned Traefik tag or digest"
      ),
    acmeEmail: z.email().max(320).nullable(),
  })
  .strict()

const webRouteHostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u,
    "Enter a fully qualified hostname without a scheme or path"
  )

export const relayInstanceWebRouteSchema = z
  .object({
    id: z.uuid(),
    hostname: webRouteHostnameSchema,
    path: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(/^\/(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?:[^?#])*$/u)
      .regex(
        /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/u,
        "Use an encoded URL path without spaces or routing metacharacters"
      )
      .nullable(),
    stripPrefix: z.boolean().default(true),
    targetPort: z.number().int().min(1).max(65_535),
  })
  .strict()

export const relayInstanceWebRoutesSchema = z
  .array(relayInstanceWebRouteSchema)
  .max(16)
  .superRefine((routes, context) => {
    const seen = new Set<string>()
    routes.forEach((route, index) => {
      const key = `${route.hostname}\n${route.path ?? ""}`
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Each hostname and path combination must be unique",
          path: [index, "hostname"],
        })
      }
      seen.add(key)
    })
  })

export const relayInstanceWebRouteStateSchema = z
  .object({
    edgeConnected: z.boolean(),
    message: z.string().min(1),
    proxyConnected: z.boolean(),
    requiresRestart: z.boolean(),
    routes: relayInstanceWebRoutesSchema,
    status: z.enum(["blocked", "pending_restart", "ready"]),
  })
  .strict()

export const relayProxyDiagnosticsSchema = z
  .object({
    browserOrigin: z.url(),
    containerRunning: z.boolean(),
    mode: relayProxyModeSchema,
    ports: z.array(
      z.object({
        available: z.boolean(),
        owner: z.string().nullable(),
        port: z.union([z.literal(80), z.literal(443)]),
      })
    ),
    publicReachability: z.enum(["unknown", "reachable", "unreachable"]),
    status: z.enum(["blocked", "disabled", "hearth", "ready", "starting"]),
    warnings: z.array(z.string()),
  })
  .strict()

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
  brickFormat: z.string().min(1).optional(),
  brickNetworkMode: z
    .enum(["direct", "minecraft-backend", "minecraft-proxy"])
    .optional(),
  brickPrimaryPort: z.number().int().min(1).max(65_535).optional(),
  brickSource: brickSourceSchema.optional(),
  managedByRelay: z.boolean().default(false),
  resources: relayInstanceResourcesSchema.nullable().default(null),
})

export const relayNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  uptimeSeconds: z.number().nonnegative().nullable().default(null),
  startedAt: z.string().datetime().nullable().default(null),
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
  relay: z
    .object({
      id: relayIdSchema,
      name: z.string().min(1).max(120),
      sftp: z.object({
        developmentAuthentication: z.boolean(),
        host: z.string().min(1).max(253),
        hostKeyFingerprint: z.string().startsWith("SHA256:"),
        port: z.number().int().min(1).max(65_535),
      }),
      tls: z
        .object({
          expiresAt: z.number().int().positive(),
          fingerprint: z.string().min(1),
          mode: z.enum(["external", "managed"]),
        })
        .nullable(),
    })
    .optional(),
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

export const relayFileActivityEntrySchema = z.object({
  instanceId: z.string(),
  path: z.string(),
  pinned: z.boolean(),
  lastViewedAt: z.string().datetime(),
  lastEditedAt: z.string().datetime().nullable(),
})

export const relayFileActivitySchema = z.object({
  instanceId: z.string(),
  files: z.array(relayFileActivityEntrySchema),
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

export const relayResourceStreamEventSchema = z.object({
  type: z.literal("resource"),
  instance: relayInstanceSchema,
  sequence: z.number().int().nonnegative(),
})

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

export const relayCatalogSchema = z.object({
  format: z.literal("kiln.catalog/v1"),
  bricks: z.array(brickSchema),
})

export const brickCatalogDocumentSchema = z
  .object({
    format: z.literal("kiln.catalog/v1"),
    recipes: z.array(z.string().min(1).max(2_048)).min(1).max(256),
  })
  .strict()

export type RelayDesiredState = z.infer<typeof relayDesiredStateSchema>
export type BrickId = z.infer<typeof brickIdSchema>
export type BrickVariableValue = z.infer<typeof brickVariableValueSchema>
export type BrickVariable = z.infer<typeof brickVariableSchema>
export type BrickRecipe = z.infer<typeof brickRecipeSchema>
export type BrickCatalogDocument = z.infer<typeof brickCatalogDocumentSchema>
export type Brick = z.infer<typeof brickSchema>
export type RelayCatalog = z.infer<typeof relayCatalogSchema>
export type RelayCreateInstance = z.infer<typeof relayCreateInstanceSchema>
export type RelayNetworking = z.infer<typeof relayNetworkingSchema>
export type RelayProxyMode = z.infer<typeof relayProxyModeSchema>
export type RelayProxySettings = z.infer<typeof relayProxySettingsSchema>
export type RelayProxyDiagnostics = z.infer<typeof relayProxyDiagnosticsSchema>
export type RelayInstanceWebRoute = z.infer<typeof relayInstanceWebRouteSchema>
export type RelayInstanceWebRoutes = z.infer<
  typeof relayInstanceWebRoutesSchema
>
export type RelayInstanceWebRouteState = z.infer<
  typeof relayInstanceWebRouteStateSchema
>
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
export type RelayFileActivityEntry = z.infer<
  typeof relayFileActivityEntrySchema
>
export type RelayFileActivity = z.infer<typeof relayFileActivitySchema>
export type RelayInstanceAction = z.infer<typeof relayInstanceActionSchema>
export type RelayConsoleLevel = z.infer<typeof relayConsoleLevelSchema>
export type RelayConsoleLine = z.infer<typeof relayConsoleLineSchema>
export type RelayConsole = z.infer<typeof relayConsoleSchema>
export type RelayConsoleStreamEvent = z.infer<
  typeof relayConsoleStreamEventSchema
>
export type RelayResourceStreamEvent = z.infer<
  typeof relayResourceStreamEventSchema
>
export type RelayConsoleCommand = z.infer<typeof relayConsoleCommandSchema>
export type RelayConsoleCommandResult = z.infer<
  typeof relayConsoleCommandResultSchema
>
export type RelayConsoleCompletionInput = z.infer<
  typeof relayConsoleCompletionInputSchema
>
export type RelayConsoleCompletion = z.infer<
  typeof relayConsoleCompletionSchema
>
export type RelayLatestLog = z.infer<typeof relayLatestLogSchema>
