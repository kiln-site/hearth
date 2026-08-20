import { assert, beforeEach, describe, it } from "@effect/vitest"
import { vi } from "vite-plus/test"

const state = vi.hoisted(() => ({
  deleteFails: false,
  events: [] as Array<string>,
  pendingReads: 0,
}))

vi.mock("@workspace/contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/contracts")>()
  return {
    ...actual,
    relayControlDeadlineMs: () => 1_000,
    relaySnapshotSchema: { parse: (value: unknown) => value },
  }
})

vi.mock("@/effect/backups", async () => {
  const { Effect } = await import("effect")
  const deletion = {
    backupId: "backup-one",
    backupStatus: "available",
    error: null,
    relayId: "relay-one",
    requestedBy: "user-one",
    status: "deleting",
    targetId: "instance-one",
    taskError: null,
  }
  return {
    listPendingFinalInstanceDeletionsEffect: () =>
      Effect.sync(() => {
        state.pendingReads += 1
        return state.pendingReads === 1 ? [deletion] : []
      }),
    purgeInstanceBackupRepositoriesEffect: () =>
      Effect.sync(() => state.events.push("purge")),
    updateFinalInstanceDeletionEffect: (input: { status: string }) =>
      Effect.sync(() => {
        state.events.push(`update:${input.status}`)
        return true
      }),
  }
})

vi.mock("@/effect/runtime", async () => {
  const { Effect } = await import("effect")
  return {
    runAppEffect: (_operation: string, effect: unknown) =>
      Effect.runPromise(effect as never),
  }
})

vi.mock("@/server/domains.server", async () => {
  const { Effect } = await import("effect")
  return {
    deleteInstanceDomainEffect: () =>
      Effect.sync(() => state.events.push("domain")),
  }
})

vi.mock("@/server/instance-deletion-cleanup", async () => {
  const { Effect } = await import("effect")
  return {
    finalizeInstanceDeletionEffect: () =>
      Effect.sync(() => state.events.push("finalize")),
  }
})

vi.mock("@/lib/relay-connection", () => ({
  relayRpc: async (
    _relay: unknown,
    method: string,
    _input: unknown
  ): Promise<unknown> => {
    state.events.push(method)
    if (method === "instance.delete") {
      if (state.deleteFails) throw new Error("Relay delete failed")
      return { deleted: true, instanceId: "instance-one" }
    }
    return { instances: [{ id: "instance-one" }] }
  },
}))

import { processFinalInstanceDeletions } from "@/lib/final-instance-deletion"

describe("final instance deletion", () => {
  beforeEach(() => {
    state.deleteFails = false
    state.events.length = 0
    state.pendingReads = 0
  })

  it("purges S3 repositories only after Relay confirms deletion", async () => {
    await processFinalInstanceDeletions({ id: "relay-one" } as never)

    assert.deepEqual(state.events, [
      "domain",
      "instance.delete",
      "purge",
      "finalize",
      "update:completed",
    ])
  })

  it("retains S3 repositories when Relay still has the instance", async () => {
    state.deleteFails = true

    await processFinalInstanceDeletions({ id: "relay-one" } as never)

    assert.deepEqual(state.events, [
      "domain",
      "instance.delete",
      "relay.snapshot",
      "update:deleting",
    ])
  })
})
