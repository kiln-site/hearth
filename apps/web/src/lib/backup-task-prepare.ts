import { Effect } from "effect"

import type {
  BackupTaskInput,
  ResticRepositoryLocation,
} from "@workspace/contracts"

import {
  loadBackupRepositoryPasswordEffect,
  type BackupDispatch,
} from "@/effect/backups"
import { loadBackupStorageCredentialEffect } from "@/effect/backup-storage"
import { BackupStorageError } from "@/effect/errors"
import {
  signS3BackupDelete,
  signS3BackupRestore,
  signS3BackupUpload,
} from "@/lib/backup-storage-s3"

export const prepareBackupTaskEffect = Effect.fn("backups.prepareTask")(
  function* (input: BackupDispatch) {
    if (input.kind === "export") {
      const repository = yield* resticRepositoryForBackup(input.backupId)
      const { repositoryPassword: _, ...task } = input
      return {
        ...task,
        repository: repository.location,
        repositoryPassword: repository.password,
      } satisfies BackupTaskInput
    }
    if (input.kind === "create" && input.mode === "incremental") {
      const artifact = input.artifacts[0]
      if (!artifact) {
        return yield* invalidDestination("The backup has no stored artifacts")
      }
      const repository = yield* resticRepositoryForBackup(input.backupId, {
        requireEnabled: true,
      })
      const { artifacts: _, repositoryPassword: __, ...task } = input
      return {
        ...task,
        destination: {
          artifactId: artifact.artifactId,
          kind: "restic" as const,
          repository: repository.location,
          repositoryPassword: repository.password,
        },
        replicas: [],
      } satisfies BackupTaskInput
    }
    if (
      input.kind === "delete" &&
      (input.snapshotId !== undefined || input.createTaskId !== undefined)
    ) {
      const artifact = input.artifacts[0]
      if (!artifact) {
        return yield* invalidDestination("The backup has no stored artifacts")
      }
      const repository = yield* resticRepositoryForBackup(input.backupId)
      const {
        artifacts: _,
        createTaskId,
        repositoryPassword: __,
        snapshotId,
        ...task
      } = input
      return {
        ...task,
        destination: {
          artifactId: artifact.artifactId,
          kind: "restic" as const,
          repository: repository.location,
          repositoryPassword: repository.password,
          ...(snapshotId
            ? { snapshotId }
            : { createTaskId: createTaskId as string }),
        },
        replicas: [],
      } satisfies BackupTaskInput
    }
    if (input.kind === "create" || input.kind === "delete") {
      if (input.artifacts.length === 0) {
        return yield* invalidDestination("The backup has no stored artifacts")
      }
      const destinations: Array<
        Extract<BackupTaskInput, { kind: typeof input.kind }>["destination"]
      > = []
      for (const artifact of input.artifacts) {
        if (artifact.storageId === null) {
          if (artifact.objectKey !== null) {
            return yield* invalidDestination(
              "A local backup cannot have a remote object key"
            )
          }
          destinations.push({ artifactId: artifact.artifactId, kind: "local" })
          continue
        }
        if (!artifact.objectKey) {
          return yield* invalidDestination(
            "An S3 backup is missing its remote object key"
          )
        }
        const storage = yield* loadBackupStorageCredentialEffect(
          artifact.storageId
        )
        if (
          !storage ||
          storage.deleting ||
          (input.kind === "create" && !storage.enabled)
        ) {
          return yield* invalidDestination(
            "The backup destination is unavailable"
          )
        }
        destinations.push(
          input.kind === "create"
            ? {
                ...(yield* signS3BackupUpload(storage, artifact.objectKey)),
                artifactId: artifact.artifactId,
              }
            : {
                ...(yield* signS3BackupDelete(storage, artifact.objectKey)),
                artifactId: artifact.artifactId,
              }
        )
      }
      const [destination, ...replicas] = destinations
      if (!destination) {
        return yield* invalidDestination("The backup has no stored artifacts")
      }
      const { artifacts: _, ...task } = input
      return {
        ...task,
        destination,
        replicas,
      } as BackupTaskInput
    }
    if (input.snapshotId) {
      const repository = yield* resticRepositoryForBackup(input.backupId)
      const {
        artifactId: _,
        objectKey: __,
        repositoryPassword: ___,
        snapshotId,
        storageId: ____,
        ...task
      } = input
      return {
        ...task,
        source: {
          kind: "restic" as const,
          repository: repository.location,
          repositoryPassword: repository.password,
          snapshotId,
        },
      } satisfies BackupTaskInput
    }
    if (input.storageId === null) {
      if (input.objectKey !== null) {
        return yield* invalidDestination(
          "A local backup cannot have a remote object key"
        )
      }
      const { artifactId: _, objectKey: __, storageId: ___, ...task } = input
      if (input.bytes === undefined || !input.checksumSha256) {
        return yield* invalidDestination(
          "Available backup is missing restore integrity metadata"
        )
      }
      return {
        ...task,
        source: {
          bytes: input.bytes,
          checksumSha256: input.checksumSha256,
          kind: "local" as const,
        },
      } satisfies BackupTaskInput
    }
    if (!input.objectKey) {
      return yield* invalidDestination(
        "An S3 backup is missing its remote object key"
      )
    }
    const storage = yield* loadBackupStorageCredentialEffect(input.storageId)
    if (!storage) {
      return yield* invalidDestination("The backup destination is unavailable")
    }
    const signed = yield* signS3BackupRestore(storage, input.objectKey)
    const { artifactId: _, objectKey: __, storageId: ___, ...task } = input
    if (input.bytes === undefined || !input.checksumSha256) {
      return yield* invalidDestination(
        "Available backup is missing restore integrity metadata"
      )
    }
    return {
      ...task,
      source: {
        ...signed,
        bytes: input.bytes,
        checksumSha256: input.checksumSha256,
      },
    } satisfies BackupTaskInput
  }
)

function invalidDestination(reason: string) {
  return BackupStorageError.make({
    code: "invalid_backup_destination",
    operation: "backup.dispatch",
    reason,
  })
}

const resticRepositoryForBackup = Effect.fnUntraced(function* (
  backupId: string,
  options?: { requireEnabled?: boolean }
) {
  const repository = yield* loadBackupRepositoryPasswordEffect(backupId)
  if (!repository.storageId) {
    return {
      location: { kind: "local" } satisfies ResticRepositoryLocation,
      password: repository.password,
    }
  }
  if (!repository.objectPrefix) {
    return yield* invalidDestination("The restic repository is unavailable")
  }
  const storage = yield* loadBackupStorageCredentialEffect(repository.storageId)
  if (
    !storage ||
    storage.deleting ||
    (options?.requireEnabled && !storage.enabled)
  ) {
    return yield* invalidDestination("The backup destination is unavailable")
  }
  return {
    location: {
      accessKeyId: storage.accessKeyId,
      allowPrivateNetwork: storage.allowPrivateNetwork,
      bucket: storage.bucket,
      endpoint: storage.endpoint,
      forcePathStyle: storage.forcePathStyle,
      kind: "s3" as const,
      region: storage.region,
      repositoryPrefix: repository.objectPrefix,
      secretAccessKey: storage.secretAccessKey,
    } satisfies ResticRepositoryLocation,
    password: repository.password,
  }
})
