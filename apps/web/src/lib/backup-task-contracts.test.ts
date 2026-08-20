import { describe, expect, it } from "vite-plus/test"

import {
  backupCreateTaskInputSchema,
  backupDeleteTaskInputSchema,
  backupExportTaskInputSchema,
  omitBackupSecrets,
  redactBackupTaskInput,
  resticRepositoryLocationSchema,
} from "@workspace/contracts"

const backupId = "11111111-1111-4111-8111-111111111111"
const taskId = "22222222-2222-4222-8222-222222222222"
const createTaskId = "33333333-3333-4333-8333-333333333333"
const target = { id: "instance-one", kind: "instance" as const }

const s3Repository = {
  accessKeyId: "AKIAEXAMPLE",
  allowPrivateNetwork: true,
  bucket: "kiln-backups",
  endpoint: "https://s3.example.com",
  forcePathStyle: true,
  kind: "s3" as const,
  region: "us-east-1",
  repositoryPrefix: "team/kiln/relay/restic/instance/srv/repo",
  secretAccessKey: "s3-secret",
}

describe("restic backup contracts", () => {
  it("defaults omitted restic repositories to local", () => {
    expect(
      backupCreateTaskInputSchema.parse({
        artifactKind: "restic_snapshot",
        backupId,
        destination: { kind: "restic", repositoryPassword: "secret" },
        exclude: [],
        maxBytes: null,
        mode: "incremental",
        reason: "manual",
        target,
        taskId,
      }).destination
    ).toMatchObject({ kind: "restic", repository: { kind: "local" } })
    expect(
      backupExportTaskInputSchema.parse({
        backupId,
        snapshotId: "abcdef12",
        target,
        taskId,
        ttlMs: 60_000,
      }).repository
    ).toEqual({ kind: "local" })
  })

  it("accepts native restic S3 repository locations", () => {
    expect(resticRepositoryLocationSchema.parse(s3Repository)).toMatchObject({
      bucket: "kiln-backups",
      kind: "s3",
      repositoryPrefix: s3Repository.repositoryPrefix,
    })
    expect(() =>
      resticRepositoryLocationSchema.parse({
        ...s3Repository,
        endpoint: "http://minio:9000",
      })
    ).toThrow()
    expect(() =>
      resticRepositoryLocationSchema.parse({
        ...s3Repository,
        endpoint: "https://minio:0",
      })
    ).toThrow()
    expect(() =>
      resticRepositoryLocationSchema.parse({
        ...s3Repository,
        repositoryPrefix: "../escape",
      })
    ).toThrow()
  })

  it("requires exactly one of snapshotId or createTaskId on restic deletes", () => {
    const base = {
      backupId,
      destination: { kind: "restic" as const },
      target,
      taskId,
    }
    expect(() => backupDeleteTaskInputSchema.parse(base)).toThrow()
    expect(() =>
      backupDeleteTaskInputSchema.parse({
        ...base,
        destination: {
          kind: "restic",
          createTaskId,
          snapshotId: "abcdef12",
        },
      })
    ).toThrow()
    expect(
      backupDeleteTaskInputSchema.parse({
        ...base,
        destination: { kind: "restic", snapshotId: "abcdef12" },
      }).destination
    ).toMatchObject({ snapshotId: "abcdef12" })
    expect(
      backupDeleteTaskInputSchema.parse({
        ...base,
        destination: { kind: "restic", createTaskId },
      }).destination
    ).toMatchObject({ createTaskId })
  })

  it("strips repository passwords and S3 keys from task input", () => {
    const redacted = redactBackupTaskInput({
      artifactKind: "restic_snapshot",
      backupId,
      destination: {
        kind: "restic",
        repository: s3Repository,
        repositoryPassword: "repo-secret",
      },
      exclude: [],
      kind: "create",
      maxBytes: null,
      mode: "incremental",
      reason: "manual",
      target,
      taskId,
    })
    expect(redacted.kind).toBe("create")
    if (redacted.kind !== "create" || redacted.destination.kind !== "restic") {
      throw new Error("expected restic create input")
    }
    expect(redacted.destination.repositoryPassword).toBeUndefined()
    expect(
      redacted.destination.repository.kind === "s3"
        ? redacted.destination.repository.accessKeyId
        : "present"
    ).toBeUndefined()
    expect(
      redacted.destination.repository.kind === "s3"
        ? redacted.destination.repository.secretAccessKey
        : "present"
    ).toBeUndefined()
    expect(
      omitBackupSecrets({
        accessKeyId: "AKIAEXAMPLE",
        nested: { repositoryPassword: "secret", value: 1 },
        secretAccessKey: "s3-secret",
      })
    ).toEqual({ nested: { value: 1 } })
  })
})
