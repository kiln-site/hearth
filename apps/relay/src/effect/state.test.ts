import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, assert, describe, layer } from "@effect/vitest"
import { Effect } from "effect"

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
  })
})
