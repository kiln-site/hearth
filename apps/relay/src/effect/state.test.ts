import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, assert, describe, layer } from "@effect/vitest"
import { Effect } from "effect"
import type { BackupTaskInput } from "@workspace/contracts"

import { makeRelayStateLayer, RelayStateStore } from "./state.js"

const testDirectory = mkdtempSync(join(tmpdir(), "kiln-relay-state-"))

afterAll(() => {
  rmSync(testDirectory, { force: true, recursive: true })
})

describe("Relay state", () => {
  layer(makeRelayStateLayer(join(testDirectory, "relay.sqlite")))((it) => {
    it.effect("pairs a client exactly once and persists its grant", () =>
      Effect.gen(function* () {
        const store = yield* RelayStateStore
        const now = Date.UTC(2026, 0, 1)
        yield* store.createInvitation({
          actions: ["*"],
          createdAt: now,
          expiresAt: now + 15 * 60_000,
          id: "invitation-1",
          role: "full_access",
          tokenHash: "hash-1",
        })
        const invitation = yield* store.findActiveInvitation(
          "invitation-1",
          now
        )
        assert.isNotNull(invitation)
        if (!invitation) return
        assert.lengthOf(yield* store.listInvitations(now), 1)

        yield* store.pairClient({
          actions: invitation.actions,
          id: "hearth-1",
          invitationId: invitation.id,
          name: "Hearth One",
          origins: ["https://hearth.test"],
          pairedAt: now + 1,
          publicKey: "public-key-1",
          role: invitation.role,
          sourceCidrs: [],
        })
        assert.isNull(
          yield* store.findActiveInvitation("invitation-1", now + 2)
        )
        const paired = yield* store.findClientByPublicKey("public-key-1")
        assert.deepStrictEqual(paired, {
          actions: ["*"],
          id: "hearth-1",
          invitationId: invitation.id,
          name: "Hearth One",
          origins: ["https://hearth.test"],
          publicKey: "public-key-1",
          role: "full_access",
          sourceCidrs: [],
          createdAt: now + 1,
          lastAddress: null,
          lastSeenAt: now + 1,
        })

        assert.isTrue(
          yield* store.updateClient({
            actions: ["relay.read"],
            clientId: "hearth-1",
            name: "Hearth Renamed",
            role: "read_only",
            sourceCidrs: ["192.0.2.1/32"],
          })
        )
        yield* store.touchClient("hearth-1", now + 2, "192.0.2.1")
        const updated = yield* store.findClientById("hearth-1")
        assert.strictEqual(updated?.name, "Hearth Renamed")
        assert.strictEqual(updated?.lastAddress, "192.0.2.1")
        assert.deepStrictEqual(updated?.sourceCidrs, ["192.0.2.1/32"])

        const duplicate = yield* Effect.result(
          store.pairClient({
            actions: invitation.actions,
            id: "hearth-2",
            invitationId: invitation.id,
            name: "Hearth Two",
            origins: [],
            pairedAt: now + 3,
            publicKey: "public-key-2",
            role: invitation.role,
            sourceCidrs: [],
          })
        )
        assert.strictEqual(duplicate._tag, "Failure")
      })
    )

    it.effect("re-enrolls the same client with a new invitation", () =>
      Effect.gen(function* () {
        const store = yield* RelayStateStore
        const now = Date.UTC(2026, 0, 2)
        yield* store.createInvitation({
          actions: ["relay.read"],
          createdAt: now,
          expiresAt: now + 15 * 60_000,
          id: "repair-invitation-1",
          role: "read_only",
          tokenHash: "repair-hash-1",
        })
        yield* store.pairClient({
          actions: ["relay.read"],
          id: "repair-hearth-1",
          invitationId: "repair-invitation-1",
          name: "Hearth Before Repair",
          origins: ["https://old.hearth.test"],
          pairedAt: now + 1,
          publicKey: "repair-public-key-1",
          role: "read_only",
          sourceCidrs: ["192.0.2.1/32"],
        })
        yield* store.createInvitation({
          actions: ["*"],
          createdAt: now + 2,
          expiresAt: now + 15 * 60_000,
          id: "repair-invitation-2",
          role: "full_access",
          tokenHash: "repair-hash-2",
        })
        yield* store.pairClient({
          actions: ["*"],
          id: "repair-hearth-1",
          invitationId: "repair-invitation-2",
          name: "Hearth After Repair",
          origins: ["https://new.hearth.test"],
          pairedAt: now + 3,
          publicKey: "repair-public-key-1",
          role: "full_access",
          sourceCidrs: [],
        })

        const repaired = yield* store.findClientById("repair-hearth-1")
        assert.deepInclude(repaired, {
          actions: ["*"],
          createdAt: now + 1,
          invitationId: "repair-invitation-2",
          name: "Hearth After Repair",
          origins: ["https://new.hearth.test"],
          role: "full_access",
          sourceCidrs: [],
        })
        assert.isNull(
          yield* store.findActiveInvitation("repair-invitation-2", now + 4)
        )
      })
    )

    it.effect(
      "lists and revokes pending invitations without exposing reuse",
      () =>
        Effect.gen(function* () {
          const store = yield* RelayStateStore
          const now = Date.UTC(2026, 0, 1)
          yield* store.createInvitation({
            actions: ["relay.read"],
            createdAt: now,
            expiresAt: now + 60_000,
            id: "invitation-2",
            role: "read_only",
            tokenHash: "hash-2",
          })
          assert.isTrue(yield* store.revokeInvitation("invitation-2", now + 1))
          assert.isNull(
            yield* store.findActiveInvitation("invitation-2", now + 2)
          )
          assert.isFalse(yield* store.revokeInvitation("invitation-2", now + 3))
        })
    )

    it.effect("revokes clients without deleting their durable record", () =>
      Effect.gen(function* () {
        const store = yield* RelayStateStore
        assert.isTrue(
          yield* store.revokeClient("hearth-1", Date.UTC(2026, 0, 2))
        )
        assert.isNull(yield* store.findClientByPublicKey("public-key-1"))
        assert.isFalse(
          yield* store.revokeClient("hearth-1", Date.UTC(2026, 0, 3))
        )
      })
    )

    it.effect("returns bounded security audit history newest first", () =>
      Effect.gen(function* () {
        const store = yield* RelayStateStore
        yield* store.appendAudit({
          clientId: "hearth-audit",
          details: { role: "read_only" },
          event: "client.updated",
          id: "audit-1",
          occurredAt: 10,
          requestId: "request-1",
        })
        yield* store.appendAudit({
          clientId: "hearth-audit",
          details: {},
          event: "client.revoked",
          id: "audit-2",
          occurredAt: 20,
          requestId: "request-2",
        })
        const audits = yield* store.listAudits({ limit: 1 })
        assert.lengthOf(audits, 1)
        assert.strictEqual(audits[0]?.id, "audit-2")
      })
    )

    it.effect("filters security audit history by occurrence time", () =>
      Effect.gen(function* () {
        const store = yield* RelayStateStore
        const audits = yield* store.listAudits({
          from: 15,
          limit: 20,
          to: 25,
        })
        assert.deepStrictEqual(
          audits.map((audit) => audit.id),
          ["audit-2"]
        )
      })
    )

    it.effect("filters instance audits before applying the result limit", () =>
      Effect.gen(function* () {
        const store = yield* RelayStateStore
        yield* store.appendAudit({
          clientId: "hearth-audit",
          details: { instanceId: "instance-other" },
          event: "control.mutation",
          id: "audit-other-instance",
          occurredAt: 40,
          requestId: "request-other-instance",
        })
        yield* store.appendAudit({
          clientId: "hearth-audit",
          details: { instanceId: "instance-allowed" },
          event: "control.mutation",
          id: "audit-allowed-instance",
          occurredAt: 30,
          requestId: "request-allowed-instance",
        })

        const audits = yield* store.listAudits({
          instanceIds: ["instance-allowed"],
          limit: 1,
        })

        assert.deepStrictEqual(
          audits.map((audit) => audit.id),
          ["audit-allowed-instance"]
        )
      })
    )

    it.effect("persists Relay-owned instance names", () =>
      Effect.gen(function* () {
        const store = yield* RelayStateStore
        yield* store.setInstanceName("instance-a", "Survival")
        yield* store.setInstanceName("instance-b", "Creative")
        assert.deepStrictEqual(yield* store.listInstanceNames(), [
          { instanceId: "instance-a", name: "Survival" },
          { instanceId: "instance-b", name: "Creative" },
        ])

        yield* store.setInstanceName("instance-a", "Survival SMP")
        yield* store.setInstanceName("instance-b", "Survival SMP")
        assert.deepStrictEqual(yield* store.listInstanceNames(), [
          { instanceId: "instance-a", name: "Survival SMP" },
          { instanceId: "instance-b", name: "Survival SMP" },
        ])

        yield* store.deleteInstanceName("instance-a")
        assert.deepStrictEqual(yield* store.listInstanceNames(), [
          { instanceId: "instance-b", name: "Survival SMP" },
        ])
      })
    )

    it.effect("persists pending primary ports until they are applied", () =>
      Effect.gen(function* () {
        const store = yield* RelayStateStore
        yield* store.setPendingPrimaryPort("instance-a", {
          internalPort: 25_565,
          protocol: "tcp",
        })
        assert.deepStrictEqual(
          yield* store.getPendingPrimaryPort("instance-a"),
          {
            id: "primary",
            instanceId: "instance-a",
            internalPort: 25_565,
            name: "Default Server",
            protocol: "tcp",
          }
        )

        yield* store.setPendingPrimaryPort("instance-a", {
          internalPort: 19_132,
          protocol: "udp",
        })
        assert.deepStrictEqual(yield* store.listPendingPrimaryPorts(), [
          {
            id: "primary",
            instanceId: "instance-a",
            internalPort: 19_132,
            name: "Default Server",
            protocol: "udp",
          },
        ])

        yield* store.deletePendingPrimaryPort("instance-a")
        assert.isNull(yield* store.getPendingPrimaryPort("instance-a"))
      })
    )

    it.effect(
      "replaces instance web routes and rejects hostname collisions",
      () =>
        Effect.gen(function* () {
          const store = yield* RelayStateStore
          const first = {
            hostname: "map.example.com",
            id: "15c524a6",
            name: "Live Map",
            path: null,
            stripPrefix: true,
            targetPort: 8080,
          }
          yield* store.replaceInstanceRoutes("instance-a", [first])
          assert.deepStrictEqual(
            yield* store.listInstanceRoutes("instance-a"),
            [first]
          )
          assert.deepInclude((yield* store.listWebRoutes())[0], {
            ...first,
            instanceId: "instance-a",
          })

          const collision = yield* Effect.result(
            store.replaceInstanceRoutes("instance-b", [
              {
                ...first,
                id: "d76cfc41",
              },
            ])
          )
          assert.strictEqual(collision._tag, "Failure")
          assert.isEmpty(yield* store.listInstanceRoutes("instance-b"))

          yield* store.replaceInstanceRoutes("instance-a", [])
          assert.isEmpty(yield* store.listWebRoutes())
        })
    )

    it.effect("journals backup tasks idempotently and in queue order", () =>
      Effect.gen(function* () {
        const store = yield* RelayStateStore
        const first: BackupTaskInput = {
          artifactKind: "archive",
          backupId: "00000000-0000-4000-8000-000000000001",
          destination: { kind: "local" },
          exclude: ["logs/**", "session.lock"],
          kind: "create",
          maxBytes: 1_000_000,
          mode: "full",
          reason: "manual",
          target: { id: "instance-a", kind: "instance" },
          taskId: "00000000-0000-4000-8000-000000000011",
        }
        const second = {
          ...first,
          backupId: "00000000-0000-4000-8000-000000000002",
          destination: {
            allowPrivateNetwork: false,
            headers: {},
            kind: "s3" as const,
            objectKey: "backups/second.zip",
            uploadUrl: "https://s3.example.test/expired-upload",
          },
          taskId: "00000000-0000-4000-8000-000000000012",
        }

        const enqueued = yield* store.enqueueBackupTask(first, 100)
        assert.isFalse(enqueued.inputRefreshRequired)
        const repeated = yield* store.enqueueBackupTask(first, 200)
        assert.deepStrictEqual(repeated, enqueued)
        yield* store.enqueueBackupTask(second, 101)

        const claimed = yield* store.claimNextBackupTask(110)
        assert.strictEqual(claimed?.taskId, first.taskId)
        assert.strictEqual(claimed?.status, "running")
        assert.isTrue(
          yield* store.updateBackupTaskProgress(first.taskId, 50, 100, 120)
        )
        assert.isTrue(
          yield* store.completeBackupTask(
            first.taskId,
            {
              bytes: 100,
              checksumSha256: "a".repeat(64),
              filename: `${first.backupId}.zip`,
              warnings: [],
            },
            130
          )
        )

        const completed = yield* store.getBackupTask(first.taskId)
        assert.strictEqual(completed?.status, "succeeded")
        assert.strictEqual(completed?.bytesCompleted, 100)
        assert.strictEqual(completed?.finishedAt, 130)
        assert.deepStrictEqual(
          (yield* store.listBackupTasks(120)).map((task) => task.taskId),
          [first.taskId]
        )

        const next = yield* store.claimNextBackupTask(140)
        assert.strictEqual(next?.taskId, second.taskId)
        assert.isTrue(
          yield* store.updateBackupTaskProgress(second.taskId, 50, 100, 145)
        )
        assert.strictEqual(yield* store.requeueInterruptedBackupTasks(150), 1)
        const requeued = yield* store.getBackupTask(second.taskId)
        assert.strictEqual(requeued?.status, "queued")
        assert.isNull(requeued?.startedAt)
        assert.strictEqual(requeued?.bytesCompleted, 0)
        assert.isNull(requeued?.bytesTotal)
        assert.isNull(requeued?.result)
        assert.isTrue(requeued?.inputRefreshRequired)

        assert.isNull(yield* store.claimNextBackupTask(160))
        const refreshed = yield* store.enqueueBackupTask(
          {
            ...second,
            destination: {
              ...second.destination,
              uploadUrl: "https://s3.example.test/fresh-upload",
            },
          },
          170
        )
        assert.strictEqual(
          refreshed.input.kind === "create" &&
            refreshed.input.destination.kind === "s3"
            ? refreshed.input.destination.uploadUrl
            : null,
          "https://s3.example.test/fresh-upload"
        )
        assert.isFalse(refreshed.inputRefreshRequired)

        assert.strictEqual(
          (yield* store.claimNextBackupTask(180))?.taskId,
          second.taskId
        )
        assert.isTrue(yield* store.failBackupTask(second.taskId, "test", 190))

        const restore: BackupTaskInput = {
          backupId: first.backupId,
          bytes: 100,
          checksumSha256: "1".repeat(64),
          kind: "restore",
          source: { kind: "local" },
          target: first.target,
          taskId: "00000000-0000-4000-8000-000000000013",
        }
        yield* store.enqueueBackupTask(restore, 200)
        assert.strictEqual(
          (yield* store.claimNextBackupTask(210))?.taskId,
          restore.taskId
        )
        assert.strictEqual(yield* store.requeueInterruptedBackupTasks(220), 1)
        const interruptedRestore = yield* store.getBackupTask(restore.taskId)
        assert.strictEqual(interruptedRestore?.status, "failed")
        assert.strictEqual(interruptedRestore?.finishedAt, 220)

        const deletion: BackupTaskInput = {
          backupId: first.backupId,
          destination: { kind: "local" },
          kind: "delete",
          target: first.target,
          taskId: "00000000-0000-4000-8000-000000000015",
        }
        yield* store.enqueueBackupTask(deletion, 230)
        assert.strictEqual(
          (yield* store.claimNextBackupTask(240))?.taskId,
          deletion.taskId
        )
        assert.strictEqual(yield* store.requeueInterruptedBackupTasks(250), 1)
        const requeuedDeletion = yield* store.getBackupTask(deletion.taskId)
        assert.strictEqual(requeuedDeletion?.status, "queued")
        assert.isFalse(requeuedDeletion?.inputRefreshRequired)
        assert.strictEqual(
          (yield* store.claimNextBackupTask(260))?.taskId,
          deletion.taskId
        )
        assert.isTrue(
          yield* store.completeBackupTask(
            deletion.taskId,
            { warnings: [] },
            270
          )
        )
        const completedDeletion = yield* store.getBackupTask(deletion.taskId)
        assert.strictEqual(completedDeletion?.bytesCompleted, 0)
        assert.strictEqual(completedDeletion?.status, "succeeded")
      })
    )

    it.effect("reclaims interrupted local creates without Hearth", () =>
      Effect.gen(function* () {
        const store = yield* RelayStateStore
        const local: BackupTaskInput = {
          artifactKind: "archive",
          backupId: "00000000-0000-4000-8000-000000000004",
          destination: { kind: "local" },
          exclude: [],
          kind: "create",
          maxBytes: null,
          mode: "full",
          reason: "manual",
          target: { id: "instance-b", kind: "instance" },
          taskId: "00000000-0000-4000-8000-000000000014",
        }
        yield* store.enqueueBackupTask(local, 300)
        assert.strictEqual(
          (yield* store.claimNextBackupTask(310))?.taskId,
          local.taskId
        )
        assert.isTrue(
          yield* store.updateBackupTaskProgress(local.taskId, 25, 50, 320)
        )

        assert.strictEqual(yield* store.requeueInterruptedBackupTasks(330), 1)
        const requeued = yield* store.getBackupTask(local.taskId)
        assert.strictEqual(requeued?.bytesCompleted, 0)
        assert.isNull(requeued?.bytesTotal)
        assert.isFalse(requeued?.inputRefreshRequired)
        assert.strictEqual(
          (yield* store.claimNextBackupTask(340))?.taskId,
          local.taskId
        )
      })
    )
  })
})
