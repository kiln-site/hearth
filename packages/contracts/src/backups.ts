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

export const backupTaskKindSchema = z.enum(["create", "restore", "delete"])

export const backupTaskStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
])

export const backupTargetSchema = z
  .object({
    id: z.string().min(1).max(120),
    kind: backupTargetKindSchema,
  })
  .strict()

export const backupLocalDestinationSchema = z
  .object({
    kind: z.literal("local"),
  })
  .strict()

export const backupS3UploadDestinationSchema = z
  .object({
    allowPrivateNetwork: z.boolean().default(false),
    headers: z.record(z.string(), z.string()).default({}),
    kind: z.literal("s3"),
    objectKey: backupObjectKeySchema,
    uploadUrl: backupHttpsUrlSchema,
  })
  .strict()

export const backupCreateTaskInputSchema = z
  .object({
    artifactKind: backupArtifactKindSchema,
    backupId: backupIdSchema,
    destination: z.discriminatedUnion("kind", [
      backupLocalDestinationSchema,
      backupS3UploadDestinationSchema,
    ]),
    exclude: z.array(z.string().min(1).max(1_024)).max(1_000),
    maxBytes: z.number().int().positive().nullable(),
    mode: backupModeSchema,
    reason: backupReasonSchema,
    target: backupTargetSchema,
    taskId: backupTaskIdSchema,
  })
  .strict()

export const backupLocalSourceSchema = z
  .object({
    kind: z.literal("local"),
  })
  .strict()

export const backupRemoteSourceSchema = z
  .object({
    allowPrivateNetwork: z.boolean().default(false),
    downloadUrl: backupHttpsUrlSchema,
    headers: z.record(z.string(), z.string()).default({}),
    kind: z.literal("remote"),
  })
  .strict()

export const backupRestoreTaskInputSchema = z
  .object({
    backupId: backupIdSchema,
    bytes: z.number().int().nonnegative(),
    checksumSha256: backupChecksumSha256Schema,
    source: z.discriminatedUnion("kind", [
      backupLocalSourceSchema,
      backupRemoteSourceSchema,
    ]),
    target: backupTargetSchema,
    taskId: backupTaskIdSchema,
  })
  .strict()

export const backupDeleteTaskInputSchema = z
  .object({
    backupId: backupIdSchema,
    destination: z.discriminatedUnion("kind", [
      backupLocalDestinationSchema,
      backupS3UploadDestinationSchema.omit({ uploadUrl: true }).extend({
        deleteUrl: backupHttpsUrlSchema,
      }),
    ]),
    target: backupTargetSchema,
    taskId: backupTaskIdSchema,
  })
  .strict()

export const backupTaskInputSchema = z.discriminatedUnion("kind", [
  backupCreateTaskInputSchema.extend({ kind: z.literal("create") }),
  backupRestoreTaskInputSchema.extend({ kind: z.literal("restore") }),
  backupDeleteTaskInputSchema.extend({ kind: z.literal("delete") }),
])

export const backupCreateTaskResultSchema = z
  .object({
    bytes: z.number().int().nonnegative(),
    checksumSha256: backupChecksumSha256Schema,
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
    warnings: z.array(z.string().max(1_024)).max(1_000),
  })
  .strict()

export const backupTaskResultSchema = z.union([
  backupCreateTaskResultSchema,
  backupOperationTaskResultSchema,
])

export const relayBackupTaskSchema = z
  .object({
    backupId: backupIdSchema,
    bytesCompleted: z.number().int().nonnegative(),
    bytesTotal: z.number().int().nonnegative().nullable(),
    createdAt: z.number().int().nonnegative(),
    error: z.string().max(4_096).nullable(),
    finishedAt: z.number().int().nonnegative().nullable(),
    input: backupTaskInputSchema,
    inputRefreshRequired: z.boolean(),
    kind: backupTaskKindSchema,
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
    if (task.kind === "create" && !("bytes" in task.result)) {
      context.addIssue({
        code: "custom",
        message: "Succeeded create tasks require an artifact result",
      })
    }
    if (task.kind !== "create" && "bytes" in task.result) {
      context.addIssue({
        code: "custom",
        message: "Backup operation tasks cannot return an artifact result",
      })
    }
  })

export type BackupArtifactKind = z.infer<typeof backupArtifactKindSchema>
export type BackupArchiveManifest = z.infer<typeof backupArchiveManifestSchema>
export type BackupCreateTaskInput = z.infer<typeof backupCreateTaskInputSchema>
export type BackupCreateTaskResult = z.infer<
  typeof backupCreateTaskResultSchema
>
export type BackupDeleteTaskInput = z.infer<typeof backupDeleteTaskInputSchema>
export type BackupMode = z.infer<typeof backupModeSchema>
export type BackupReason = z.infer<typeof backupReasonSchema>
export type BackupRestoreTaskInput = z.infer<
  typeof backupRestoreTaskInputSchema
>
export type BackupStatus = z.infer<typeof backupStatusSchema>
export type BackupTarget = z.infer<typeof backupTargetSchema>
export type BackupTargetKind = z.infer<typeof backupTargetKindSchema>
export type BackupTaskInput = z.infer<typeof backupTaskInputSchema>
export type BackupTaskKind = z.infer<typeof backupTaskKindSchema>
export type BackupTaskResult = z.infer<typeof backupTaskResultSchema>
export type BackupTaskStatus = z.infer<typeof backupTaskStatusSchema>
export type RelayBackupTask = z.infer<typeof relayBackupTaskSchema>
