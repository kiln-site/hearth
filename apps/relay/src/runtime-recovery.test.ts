import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, assert, describe, layer } from "@effect/vitest"
import { Effect, Ref } from "effect"

import { loadConfig } from "./config.js"
import { makeRelayStateLayer, RelayStateStore } from "./effect/state.js"
import {
  RuntimeRecoveryManager,
  type RuntimeRecoveryObservation,
} from "./runtime-recovery.js"

const testDirectory = mkdtempSync(join(tmpdir(), "kiln-runtime-recovery-"))

afterAll(() => {
  rmSync(testDirectory, { force: true, recursive: true })
})

function observation(
  instanceId: string,
  overrides: Partial<RuntimeRecoveryObservation> = {}
): RuntimeRecoveryObservation {
  return {
    exitCode: 0,
    finishedAt: "0001-01-01T00:00:00.000Z",
    installationReady: true,
    instanceId,
    managedByRelay: true,
    oomKilled: false,
    ready: true,
    running: true,
    service: `kiln-${instanceId.slice(0, 8)}`,
    startedAt: "2026-08-06T12:00:00.000Z",
    transitionActive: false,
    ...overrides,
  }
}

describe("runtime recovery", () => {
  layer(makeRelayStateLayer(join(testDirectory, "relay.sqlite")))((it) => {
    it.effect("restarts twice, then opens the crash-loop circuit", () =>
      Effect.gen(function* () {
        const state = yield* RelayStateStore
        const starts = yield* Ref.make(0)
        const config = loadConfig({
          KILN_RELAY_CRASH_RETRY_DELAY_SECONDS: "5",
          KILN_RELAY_CRASH_RETRY_LIMIT: "2",
          KILN_RELAY_CRASH_STABILITY_SECONDS: "300",
          NODE_ENV: "test",
        })
        const manager = new RuntimeRecoveryManager(config, state, () =>
          Ref.update(starts, (count) => count + 1)
        )
        yield* manager.initialize()

        const instanceId = "1".repeat(40)
        const firstStartedAt = "2026-08-06T12:00:00.000Z"
        const firstStartedAtMs = Date.parse(firstStartedAt)
        yield* manager.reconcile(
          [observation(instanceId, { startedAt: firstStartedAt })],
          firstStartedAtMs
        )

        const firstCrashAt = firstStartedAtMs + 10_000
        const firstCrash = yield* manager.reconcile(
          [
            observation(instanceId, {
              exitCode: 1,
              finishedAt: new Date(firstCrashAt).toISOString(),
              ready: false,
              running: false,
              startedAt: firstStartedAt,
            }),
          ],
          firstCrashAt
        )
        assert.deepInclude(firstCrash.get(instanceId)?.recovery, {
          attempt: 1,
          maxAttempts: 2,
          phase: "pending",
          reason: "process_exit",
          runtimeMs: 10_000,
        })

        const firstRetryAt = firstCrashAt + 5_000
        const firstRestart = yield* manager.reconcile(
          [
            observation(instanceId, {
              exitCode: 1,
              finishedAt: new Date(firstCrashAt).toISOString(),
              ready: false,
              running: false,
              startedAt: firstStartedAt,
            }),
          ],
          firstRetryAt
        )
        assert.strictEqual(
          firstRestart.get(instanceId)?.recovery?.phase,
          "restarting"
        )

        const secondStartedAt = new Date(firstRetryAt + 1_000).toISOString()
        yield* manager.reconcile(
          [observation(instanceId, { startedAt: secondStartedAt })],
          firstRetryAt + 2_000
        )
        assert.isNull(manager.snapshot(instanceId)?.recovery)

        const secondCrashAt = firstRetryAt + 3_000
        const secondCrash = yield* manager.reconcile(
          [
            observation(instanceId, {
              exitCode: 137,
              finishedAt: new Date(secondCrashAt).toISOString(),
              oomKilled: true,
              ready: false,
              running: false,
              startedAt: secondStartedAt,
            }),
          ],
          secondCrashAt
        )
        assert.deepInclude(secondCrash.get(instanceId)?.recovery, {
          attempt: 2,
          oomKilled: true,
          phase: "pending",
          reason: "out_of_memory",
        })

        const secondRetryAt = secondCrashAt + 15_000
        yield* manager.reconcile(
          [
            observation(instanceId, {
              exitCode: 137,
              finishedAt: new Date(secondCrashAt).toISOString(),
              oomKilled: true,
              ready: false,
              running: false,
              startedAt: secondStartedAt,
            }),
          ],
          secondRetryAt
        )

        const thirdStartedAt = new Date(secondRetryAt + 1_000).toISOString()
        const exhausted = yield* manager.reconcile(
          [
            observation(instanceId, {
              exitCode: 1,
              finishedAt: new Date(secondRetryAt + 2_000).toISOString(),
              ready: false,
              running: false,
              startedAt: thirdStartedAt,
            }),
          ],
          secondRetryAt + 2_000
        )
        assert.deepInclude(exhausted.get(instanceId)?.recovery, {
          attempt: 2,
          phase: "failed",
          reason: "process_exit",
        })
        assert.strictEqual(yield* Ref.get(starts), 2)

        const persisted = yield* state.getRuntimeRecovery(instanceId)
        assert.strictEqual(persisted?.phase, "failed")
        assert.strictEqual(persisted?.desiredState, "running")
      })
    )

    it.effect("does not restart an incomplete Ember installation", () =>
      Effect.gen(function* () {
        const state = yield* RelayStateStore
        const config = loadConfig({ NODE_ENV: "test" })
        const manager = new RuntimeRecoveryManager(config, state, () =>
          Effect.die("installer recovery must not start the container")
        )
        yield* manager.initialize()

        const instanceId = "2".repeat(40)
        yield* manager.recordProvisioned(instanceId, "running", 100)
        const result = yield* manager.reconcile(
          [
            observation(instanceId, {
              exitCode: 1,
              finishedAt: "2026-08-06T12:00:02.000Z",
              installationReady: false,
              ready: false,
              running: false,
            }),
          ],
          200
        )

        assert.deepStrictEqual(result.get(instanceId), {
          desiredState: "stopped",
          recovery: null,
        })
      })
    )

    it.effect("persists an intentional power stop without recovery", () =>
      Effect.gen(function* () {
        const state = yield* RelayStateStore
        const config = loadConfig({ NODE_ENV: "test" })
        const manager = new RuntimeRecoveryManager(config, state)
        yield* manager.initialize()

        const instanceId = "3".repeat(40)
        yield* manager.recordProvisioned(instanceId, "running", 100)
        yield* manager.recordPowerAction(instanceId, "stop", 200)
        const stopped = yield* manager.reconcile(
          [
            observation(instanceId, {
              finishedAt: "2026-08-06T12:00:02.000Z",
              ready: false,
              running: false,
            }),
          ],
          300
        )

        assert.deepStrictEqual(stopped.get(instanceId), {
          desiredState: "stopped",
          recovery: null,
        })
      })
    )

    it.effect("observes a manual start after the retry circuit opens", () =>
      Effect.gen(function* () {
        const state = yield* RelayStateStore
        const config = loadConfig({
          KILN_RELAY_CRASH_RETRY_LIMIT: "0",
          NODE_ENV: "test",
        })
        const manager = new RuntimeRecoveryManager(config, state)
        yield* manager.initialize()

        const instanceId = "4".repeat(40)
        yield* manager.recordProvisioned(instanceId, "running", 100)
        const failed = yield* manager.reconcile(
          [
            observation(instanceId, {
              exitCode: 1,
              finishedAt: "2026-08-06T12:00:02.000Z",
              ready: false,
              running: false,
            }),
          ],
          200
        )
        assert.strictEqual(failed.get(instanceId)?.recovery?.phase, "failed")

        const manuallyStarted = yield* manager.reconcile(
          [
            observation(instanceId, {
              ready: true,
              running: true,
              startedAt: "2026-08-06T12:01:00.000Z",
            }),
          ],
          Date.parse("2026-08-06T12:01:10.000Z")
        )

        assert.deepStrictEqual(manuallyStarted.get(instanceId), {
          desiredState: "running",
          recovery: null,
        })
        assert.strictEqual(
          (yield* state.getRuntimeRecovery(instanceId))?.phase,
          "monitoring"
        )
      })
    )

    it.effect("does not persist recovery state for unmanaged containers", () =>
      Effect.gen(function* () {
        const state = yield* RelayStateStore
        const config = loadConfig({ NODE_ENV: "test" })
        const manager = new RuntimeRecoveryManager(config, state)
        yield* manager.initialize()

        const instanceId = "5".repeat(40)
        const result = yield* manager.reconcile(
          [observation(instanceId, { managedByRelay: false })],
          100
        )

        assert.deepStrictEqual(result.get(instanceId), {
          desiredState: "running",
          recovery: null,
        })
        assert.isNull(yield* state.getRuntimeRecovery(instanceId))
      })
    )
  })
})
