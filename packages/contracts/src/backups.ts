import { z } from "zod"

const backupHttpsUrlSchema = z
  .url()
  .max(8_192)
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Backup URLs must use HTTPS",
  })

const hasUnsafeControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint < 32 || codePoint === 127)
  })

export const backupObjectKeySchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine((value) => !value.startsWith("/"), {
    message: "Backup object keys must be relative",
  })
  .refine((value) => !value.split("/").includes(".."), {
    message: "Backup object keys cannot traverse parent directories",
  })
  .refine((value) => !hasUnsafeControlCharacter(value), {
    message: "Backup object keys cannot contain control characters",
  })

export const backupIdSchema = z.uuid()
export const backupTaskIdSchema = z.uuid()

export const backupChecksumSha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)

export const resticSnapshotIdSchema = z.string().regex(/^[a-f0-9]{8,64}$/u)

export const backupRepositoryPasswordSchema = z.string().min(1).max(1_024)

export const backupFilenameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !value.includes("/") &&
      !value.includes("\\") &&
      !hasUnsafeControlCharacter(value),
    { message: "Backup filenames must be a single safe path segment" }
  )

export const backupTargetKindSchema = z.enum([
  "instance",
  "database",
  "platform",
])

export const backupArtifactKindSchema = z.enum([
  "archive",
  "database_dump",
  "platform_bundle",
  "restic_snapshot",
])

export const backupModeSchema = z.enum(["full", "incremental"])

export const backupReasonSchema = z.enum([
  "manual",
  "pre_restore",
  "final_delete",
  "scheduled",
])

export const backupStatusSchema = z.enum([
  "queued",
  "running",
  "available",
  "failed",
  "deleting",
  "deleted",
])

export const backupTaskKindSchema = z.enum([
  "create",
  "restore",
  "delete",
  "export",
  "prune",
])

export const backupTaskStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
])

export const backupTaskPhaseSchema = z.enum([
  "preparing",
  "collecting",
  "archiving",
  "dumping",
  "uploading",
  "finalizing",
])

export const backupArtifactStatusSchema = z.enum([
  "queued",
  "running",
  "available",
  "failed",
  "deleting",
  "deleted",
])

export const backupTargetSchema = z
  .object({
    id: z.string().min(1).max(120),
    kind: backupTargetKindSchema,
  })
  .strict()

export const backupLocalDestinationSchema = z
  .object({
    artifactId: z.uuid().optional(),
    kind: z.literal("local"),
  })
  .strict()

export const backupS3UploadDestinationSchema = z
  .object({
    allowPrivateNetwork: z.boolean().default(false),
    artifactId: z.uuid().optional(),
    headers: z.record(z.string(), z.string()).default({}),
    kind: z.literal("s3"),
    objectKey: backupObjectKeySchema,
    uploadUrl: backupHttpsUrlSchema,
  })
  .strict()

export const resticS3BucketSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u, {
    message: "S3 bucket names must follow S3 naming rules",
  })

export const resticS3RegionSchema = z.string().regex(/^[a-z0-9-]+$/u, {
  message:
    "S3 regions must contain only lowercase letters, digits, and hyphens",
})

export const resticRepositoryPrefixSchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(/^[A-Za-z0-9._/-]+$/u, {
    message:
      "Restic repository prefixes can contain only letters, digits, dots, underscores, slashes, and hyphens",
  })
  .refine((value) => !value.startsWith("/"), {
    message: "Backup object keys must be relative",
  })
  .refine((value) => !value.split("/").includes(".."), {
    message: "Backup object keys cannot traverse parent directories",
  })
  .refine((value) => !hasUnsafeControlCharacter(value), {
    message: "Backup object keys cannot contain control characters",
  })

const resticS3EndpointSchema = backupHttpsUrlSchema.refine(
  (value) => {
    const endpoint = new URL(value)
    const port = endpoint.port ? Number(endpoint.port) : 443
    return (
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.search &&
      !endpoint.hash &&
      (endpoint.pathname === "/" || endpoint.pathname === "") &&
      Number.isSafeInteger(port) &&
      port >= 1 &&
      port <= 65_535
    )
  },
  {
    message:
      "Restic S3 endpoints must be an HTTPS origin without credentials, a path, query, or fragment",
  }
)

const resticLocalRepositoryLocationSchema = z
  .object({
    kind: z.literal("local"),
  })
  .strict()

const resticS3RepositoryLocationObjectSchema = z
  .object({
    accessKeyId: z.string().min(1).max(512).optional(),
    allowPrivateNetwork: z.boolean().default(false),
    bucket: resticS3BucketSchema,
    endpoint: resticS3EndpointSchema,
    forcePathStyle: z.boolean().default(false),
    kind: z.literal("s3"),
    region: resticS3RegionSchema,
    repositoryPrefix: resticRepositoryPrefixSchema,
    secretAccessKey: z.string().min(1).max(2_048).optional(),
  })
  .strict()

export const resticRepositoryLocationSchema = z.discriminatedUnion("kind", [
  resticLocalRepositoryLocationSchema,
  resticS3RepositoryLocationObjectSchema,
])

const defaultLocalResticRepository = { kind: "local" as const }

export const backupResticDestinationSchema = z
  .object({
    artifactId: z.uuid().optional(),
    kind: z.literal("restic"),
    repository: resticRepositoryLocationSchema.default(
      defaultLocalResticRepository
    ),
    repositoryPassword: backupRepositoryPasswordSchema.optional(),
  })
  .strict()

const backupArchiveDestinationSchema = z.discriminatedUnion("kind", [
  backupLocalDestinationSchema,
  backupS3UploadDestinationSchema,
])

const backupCreateTaskInputObjectSchema = z
  .object({
    artifactKind: backupArtifactKindSchema,
    backupId: backupIdSchema,
    destination: z.discriminatedUnion("kind", [
      backupLocalDestinationSchema,
      backupS3UploadDestinationSchema,
      backupResticDestinationSchema,
    ]),
    exclude: z.array(z.string().min(1).max(1_024)).max(1_000),
    maxBytes: z.number().int().positive().nullable(),
    mode: backupModeSchema,
    reason: backupReasonSchema,
    replicas: z.array(backupArchiveDestinationSchema).max(15).optional(),
    target: backupTargetSchema,
    taskId: backupTaskIdSchema,
  })
  .strict()

function refineResticCreateInput(
  input: z.infer<typeof backupCreateTaskInputObjectSchema>,
  context: z.RefinementCtx
) {
  const restic = input.destination.kind === "restic"
  if (restic) {
    if ((input.replicas?.length ?? 0) > 0) {
      context.addIssue({
        code: "custom",
        message: "Restic backups cannot replicate to additional destinations",
        path: ["replicas"],
      })
    }
    if (input.mode !== "incremental") {
      context.addIssue({
        code: "custom",
        message: "Restic destinations require incremental mode",
        path: ["mode"],
      })
    }
    if (input.artifactKind !== "restic_snapshot") {
      context.addIssue({
        code: "custom",
        message: "Restic destinations require a restic_snapshot artifact",
        path: ["artifactKind"],
      })
    }
    if (input.target.kind !== "instance") {
      context.addIssue({
        code: "custom",
        message: "Restic backups are only supported for instance targets",
        path: ["target", "kind"],
      })
    }
    return
  }
  if (input.mode === "incremental") {
    context.addIssue({
      code: "custom",
      message: "Incremental backups require a restic destination",
      path: ["destination", "kind"],
    })
  }
  if (input.artifactKind === "restic_snapshot") {
    context.addIssue({
      code: "custom",
      message: "restic_snapshot artifacts require a restic destination",
      path: ["artifactKind"],
    })
  }
}

export const backupCreateTaskInputSchema =
  backupCreateTaskInputObjectSchema.superRefine(refineResticCreateInput)

export const backupLocalSourceSchema = z
  .object({
    bytes: z.number().int().nonnegative(),
    checksumSha256: backupChecksumSha256Schema,
    kind: z.literal("local"),
  })
  .strict()

export const backupRemoteSourceSchema = z
  .object({
    allowPrivateNetwork: z.boolean().default(false),
    bytes: z.number().int().nonnegative(),
    checksumSha256: backupChecksumSha256Schema,
    downloadUrl: backupHttpsUrlSchema,
    headers: z.record(z.string(), z.string()).default({}),
    kind: z.literal("remote"),
  })
  .strict()

export const backupResticSourceSchema = z
  .object({
    kind: z.literal("restic"),
    repository: resticRepositoryLocationSchema.default(
      defaultLocalResticRepository
    ),
    repositoryPassword: backupRepositoryPasswordSchema.optional(),
    snapshotId: resticSnapshotIdSchema,
  })
  .strict()

export const backupRestoreTaskInputSchema = z
  .object({
    backupId: backupIdSchema,
    source: z.discriminatedUnion("kind", [
      backupLocalSourceSchema,
      backupRemoteSourceSchema,
      backupResticSourceSchema,
    ]),
    target: backupTargetSchema,
    taskId: backupTaskIdSchema,
  })
  .strict()

export const backupS3DeleteDestinationSchema = backupS3UploadDestinationSchema
  .omit({ uploadUrl: true })
  .extend({
    deleteUrl: backupHttpsUrlSchema,
  })

export const backupDeleteTaskInputSchema = z
  .object({
    backupId: backupIdSchema,
    destination: z.discriminatedUnion("kind", [
      backupLocalDestinationSchema,
      backupS3DeleteDestinationSchema,
      backupResticDestinationSchema.extend({
        createTaskId: backupTaskIdSchema.optional(),
        snapshotId: resticSnapshotIdSchema.optional(),
      }),
    ]),
    replicas: z
      .array(
        z.discriminatedUnion("kind", [
          backupLocalDestinationSchema,
          backupS3DeleteDestinationSchema,
        ])
      )
      .max(15)
      .optional(),
    target: backupTargetSchema,
    taskId: backupTaskIdSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.destination.kind !== "restic") return
    if ((input.replicas?.length ?? 0) > 0) {
      context.addIssue({
        code: "custom",
        message: "Restic deletes cannot target additional destinations",
        path: ["replicas"],
      })
    }
    const hasSnapshot = input.destination.snapshotId !== undefined
    const hasCreateTask = input.destination.createTaskId !== undefined
    if (hasSnapshot === hasCreateTask) {
      context.addIssue({
        code: "custom",
        message:
          "Restic deletes require exactly one of snapshotId or createTaskId",
        path: ["destination", hasSnapshot ? "createTaskId" : "snapshotId"],
      })
    }
  })

export const BACKUP_EXPORT_TTL_MIN_MS = 60_000
export const BACKUP_EXPORT_TTL_MAX_MS = 7 * 24 * 60 * 60 * 1_000

export const backupExportTtlMsSchema = z
  .number()
  .int()
  .min(BACKUP_EXPORT_TTL_MIN_MS)
  .max(BACKUP_EXPORT_TTL_MAX_MS)

export const backupExportTaskInputSchema = z
  .object({
    backupId: backupIdSchema,
    repository: resticRepositoryLocationSchema.default(
      defaultLocalResticRepository
    ),
    repositoryPassword: backupRepositoryPasswordSchema.optional(),
    snapshotId: resticSnapshotIdSchema,
    target: backupTargetSchema,
    taskId: backupTaskIdSchema,
    ttlMs: backupExportTtlMsSchema,
  })
  .strict()

export const backupPruneTaskInputSchema = z
  .object({
    backupId: backupIdSchema,
    repository: resticRepositoryLocationSchema.default(
      defaultLocalResticRepository
    ),
    repositoryPassword: backupRepositoryPasswordSchema.optional(),
    target: backupTargetSchema,
    taskId: backupTaskIdSchema,
  })
  .strict()

export const backupTaskInputSchema = z.discriminatedUnion("kind", [
  backupCreateTaskInputObjectSchema
    .extend({ kind: z.literal("create") })
    .superRefine(refineResticCreateInput),
  backupRestoreTaskInputSchema.extend({ kind: z.literal("restore") }),
  backupDeleteTaskInputSchema.extend({ kind: z.literal("delete") }),
  backupExportTaskInputSchema.extend({ kind: z.literal("export") }),
  backupPruneTaskInputSchema.extend({ kind: z.literal("prune") }),
])

const backupArtifactOutcomeSchema = z
  .object({
    artifactId: z.uuid(),
    error: z.string().max(4_096).nullable(),
    status: z.enum(["available", "failed"]),
  })
  .strict()

export const backupArchiveCreateTaskResultSchema = z
  .object({
    artifacts: z.array(backupArtifactOutcomeSchema).max(16).optional(),
    bytes: z.number().int().nonnegative(),
    checksumSha256: backupChecksumSha256Schema,
    filename: backupFilenameSchema,
    warnings: z.array(z.string().max(1_024)).max(1_000),
  })
  .strict()

export const backupResticCreateTaskResultSchema = z
  .object({
    artifacts: z.array(backupArtifactOutcomeSchema).max(16).optional(),
    bytes: z.number().int().nonnegative(),
    snapshotId: resticSnapshotIdSchema,
    warnings: z.array(z.string().max(1_024)).max(1_000),
  })
  .strict()

export const backupCreateTaskResultSchema = z.union([
  backupArchiveCreateTaskResultSchema,
  backupResticCreateTaskResultSchema,
])

export const backupExportTaskResultSchema = z
  .object({
    bytes: z.number().int().nonnegative(),
    checksumSha256: backupChecksumSha256Schema,
    expiresAt: z.number().int().positive(),
    filename: backupFilenameSchema,
    warnings: z.array(z.string().max(1_024)).max(1_000),
  })
  .strict()

export const backupArchiveManifestSchema = z
  .object({
    artifactKind: z.literal("archive"),
    backupId: backupIdSchema,
    createdAt: z.string().datetime(),
    formatVersion: z.literal(1),
    mode: z.literal("full"),
    target: backupTargetSchema.refine((target) => target.kind === "instance", {
      message: "Archive manifests require an instance target",
    }),
  })
  .strict()

export const backupDownloadCapabilityPayloadSchema = z
  .object({
    action: z.literal("backup.download"),
    audience: z.string().min(1).max(120),
    backupId: backupIdSchema,
    capabilityId: z.uuid(),
    expiresAt: z.number().int().positive(),
    filename: backupFilenameSchema,
    issuedAt: z.number().int().positive(),
    issuer: z.string().min(1).max(120),
    subject: z.string().min(1).max(120),
    version: z.literal(1),
  })
  .strict()

export const backupOperationTaskResultSchema = z
  .object({
    artifacts: z
      .array(
        z
          .object({
            artifactId: z.uuid(),
            error: z.string().max(4_096).nullable(),
            status: z.enum(["deleted", "failed"]),
          })
          .strict()
      )
      .max(16)
      .optional(),
    warnings: z.array(z.string().max(1_024)).max(1_000),
  })
  .strict()

export const backupTaskResultSchema = z.union([
  backupArchiveCreateTaskResultSchema,
  backupResticCreateTaskResultSchema,
  backupExportTaskResultSchema,
  backupOperationTaskResultSchema,
])

export const relayBackupTaskSchema = z
  .object({
    backupId: backupIdSchema,
    bytesCompleted: z.number().int().nonnegative(),
    bytesTotal: z.number().int().nonnegative().nullable(),
    createdAt: z.number().int().nonnegative(),
    currentArtifactId: z.uuid().nullable().default(null),
    currentPath: z.string().max(2_048).nullable().default(null),
    error: z.string().max(4_096).nullable(),
    finishedAt: z.number().int().nonnegative().nullable(),
    input: backupTaskInputSchema,
    inputRefreshRequired: z.boolean(),
    kind: backupTaskKindSchema,
    phase: backupTaskPhaseSchema.nullable().default(null),
    result: backupTaskResultSchema.nullable(),
    startedAt: z.number().int().nonnegative().nullable(),
    status: backupTaskStatusSchema,
    taskId: backupTaskIdSchema,
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((task, context) => {
    if (
      task.kind !== task.input.kind ||
      task.backupId !== task.input.backupId ||
      task.taskId !== task.input.taskId
    ) {
      context.addIssue({
        code: "custom",
        message: "Backup task metadata must match its input",
      })
    }
    if (task.status !== "succeeded") return
    if (!task.result) {
      context.addIssue({
        code: "custom",
        message: "Succeeded backup tasks require a result",
      })
      return
    }
    if (task.kind === "create" && task.input.kind === "create") {
      const restic = task.input.destination.kind === "restic"
      if (restic && !isResticCreateTaskResult(task.result)) {
        context.addIssue({
          code: "custom",
          message: "Succeeded restic create tasks require a snapshot result",
        })
      }
      if (!restic && !isArchiveCreateTaskResult(task.result)) {
        context.addIssue({
          code: "custom",
          message: "Succeeded create tasks require an artifact result",
        })
      }
    }
    if (task.kind === "export" && !isExportTaskResult(task.result)) {
      context.addIssue({
        code: "custom",
        message: "Succeeded export tasks require a staged archive result",
      })
    }
    if (
      (task.kind === "restore" ||
        task.kind === "delete" ||
        task.kind === "prune") &&
      !isBackupOperationTaskResult(task.result)
    ) {
      context.addIssue({
        code: "custom",
        message: "Backup operation tasks cannot return an artifact result",
      })
    }
  })

export type BackupArtifactKind = z.infer<typeof backupArtifactKindSchema>
export type BackupArchiveManifest = z.infer<typeof backupArchiveManifestSchema>
export type BackupCreateTaskInput = z.infer<typeof backupCreateTaskInputSchema>
export type BackupArchiveCreateTaskResult = z.infer<
  typeof backupArchiveCreateTaskResultSchema
>
export type BackupResticCreateTaskResult = z.infer<
  typeof backupResticCreateTaskResultSchema
>
export type BackupCreateTaskResult = z.infer<
  typeof backupCreateTaskResultSchema
>
export type BackupDeleteTaskInput = z.infer<typeof backupDeleteTaskInputSchema>
export type BackupExportTaskInput = z.infer<typeof backupExportTaskInputSchema>
export type BackupExportTaskResult = z.infer<
  typeof backupExportTaskResultSchema
>
export type BackupMode = z.infer<typeof backupModeSchema>
export type BackupPruneTaskInput = z.infer<typeof backupPruneTaskInputSchema>
export type ResticRepositoryLocation = z.infer<
  typeof resticRepositoryLocationSchema
>
export type BackupReason = z.infer<typeof backupReasonSchema>
export type BackupRestoreTaskInput = z.infer<
  typeof backupRestoreTaskInputSchema
>
export type BackupStatus = z.infer<typeof backupStatusSchema>
export type BackupTarget = z.infer<typeof backupTargetSchema>
export type BackupTargetKind = z.infer<typeof backupTargetKindSchema>
export type BackupTaskInput = z.infer<typeof backupTaskInputSchema>
export type BackupTaskKind = z.infer<typeof backupTaskKindSchema>
export type BackupTaskPhase = z.infer<typeof backupTaskPhaseSchema>
export type BackupTaskResult = z.infer<typeof backupTaskResultSchema>
export type BackupTaskStatus = z.infer<typeof backupTaskStatusSchema>
export type RelayBackupTask = z.infer<typeof relayBackupTaskSchema>

const BACKUP_ARTIFACT_EXTENSIONS = {
  archive: "zip",
  database_dump: "dmp.gz",
  platform_bundle: "kiln",
  restic_snapshot: "zip",
} as const satisfies Record<BackupArtifactKind, string>

export function backupArtifactFilename(
  backupId: string,
  artifactKind: BackupArtifactKind
): string {
  return `backup-${backupId.slice(0, 8)}.${BACKUP_ARTIFACT_EXTENSIONS[artifactKind]}`
}

export function isArchiveCreateTaskResult(
  result: BackupTaskResult
): result is BackupArchiveCreateTaskResult {
  return (
    "checksumSha256" in result &&
    "filename" in result &&
    !("expiresAt" in result)
  )
}

export function isResticCreateTaskResult(
  result: BackupTaskResult
): result is BackupResticCreateTaskResult {
  return "snapshotId" in result
}

export function isExportTaskResult(
  result: BackupTaskResult
): result is BackupExportTaskResult {
  return "expiresAt" in result && "filename" in result
}

export function isBackupOperationTaskResult(
  result: BackupTaskResult
): result is z.infer<typeof backupOperationTaskResultSchema> {
  return !("bytes" in result)
}

const BACKUP_SECRET_KEYS = new Set([
  "accessKeyId",
  "repositoryPassword",
  "secretAccessKey",
])

export function redactBackupTaskInput(input: BackupTaskInput): BackupTaskInput {
  return backupTaskInputSchema.parse(omitBackupSecrets(input))
}

export function redactRelayBackupTask(task: RelayBackupTask): RelayBackupTask {
  return relayBackupTaskSchema.parse({
    ...task,
    input: redactBackupTaskInput(task.input),
  })
}

export function omitBackupSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitBackupSecrets)
  if (value === null || typeof value !== "object") return value
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (BACKUP_SECRET_KEYS.has(key)) continue
    result[key] = omitBackupSecrets(entry)
  }
  return result
}
