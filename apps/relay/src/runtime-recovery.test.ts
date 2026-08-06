import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, assert, describe, layer } from "@effect/vitest"
import { Deferred, Effect, Fiber, Ref } from "effect"

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
    dockerRestartConfigured: false,
    exitCode: 0,
    finishedAt: "0001-01-01T00:00:00.000Z",
    installationReady: true,
    instanceId,
    managedByRelay: true,
    oomKilled: false,
    ready: true,
    restarting: false,
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

    it.effect("lets a normal intentional shutdown finish gracefully", () =>
      Effect.gen(function* () {
        const state = yield* RelayStateStore
        const config = loadConfig({ NODE_ENV: "test" })
        const stops = yield* Ref.make(0)
        const manager = new RuntimeRecoveryManager(
          config,
          state,
          undefined,
          Date.now,
          () => Ref.update(stops, (count) => count + 1)
        )
        yield* manager.initialize()

        const instanceId = "e".repeat(40)
        yield* manager.recordProvisioned(instanceId, "running", 100)
        yield* manager.recordPowerAction(instanceId, "stop", 200)
        const stopping = yield* manager.reconcile(
          [observation(instanceId)],
          201
        )
        yield* Effect.yieldNow

        assert.deepStrictEqual(stopping.get(instanceId), {
          desiredState: "stopped",
          recovery: null,
        })
        assert.strictEqual(yield* Ref.get(stops), 0)
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

    it.effect("preserves running intent while Docker is restarting", () =>
      Effect.gen(function* () {
        const state = yield* RelayStateStore
        const config = loadConfig({ NODE_ENV: "test" })
        const manager = new RuntimeRecoveryManager(config, state)
        yield* manager.initialize()

        const instanceId = "6".repeat(40)
        const result = yield* manager.reconcile(
          [
            observation(instanceId, {
              dockerRestartConfigured: true,
              exitCode: 1,
              ready: false,
              restarting: true,
              running: false,
            }),
          ],
          100
        )

        assert.strictEqual(result.get(instanceId)?.desiredState, "running")
        assert.strictEqual(
          (yield* state.getRuntimeRecovery(instanceId))?.desiredState,
          "running"
        )
      })
    )

    it.effect(
      "takes over a failed container with a legacy restart policy",
      () =>
        Effect.gen(function* () {
          const state = yield* RelayStateStore
          const config = loadConfig({ NODE_ENV: "test" })
          const manager = new RuntimeRecoveryManager(config, state)
          yield* manager.initialize()

          const instanceId = "7".repeat(40)
          const result = yield* manager.reconcile(
            [
              observation(instanceId, {
                dockerRestartConfigured: true,
                exitCode: 1,
                finishedAt: "2026-08-06T12:00:02.000Z",
                ready: false,
                running: false,
              }),
            ],
            Date.parse("2026-08-06T12:00:02.000Z")
          )

          assert.deepInclude(result.get(instanceId)?.recovery, {
            attempt: 1,
            phase: "pending",
            reason: "process_exit",
          })
        })
    )

    it.effect(
      "does not block reconciliation on an in-flight Docker start",
      () =>
        Effect.gen(function* () {
          const state = yield* RelayStateStore
          const config = loadConfig({
            KILN_RELAY_CRASH_RETRY_DELAY_SECONDS: "0",
            NODE_ENV: "test",
          })
          const started = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const manager = new RuntimeRecoveryManager(config, state, () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release))
            )
          )
          yield* manager.initialize()

          const instanceId = "8".repeat(40)
          yield* manager.recordProvisioned(instanceId, "running", 100)
          yield* manager.reconcile(
            [
              observation(instanceId, {
                exitCode: 1,
                ready: false,
                running: false,
              }),
            ],
            200
          )
          const reconcileFiber = yield* manager
            .reconcile(
              [
                observation(instanceId, {
                  exitCode: 1,
                  ready: false,
                  running: false,
                }),
              ],
              201
            )
            .pipe(Effect.forkChild)

          yield* Deferred.await(started)
          yield* Effect.yieldNow
          assert.isDefined(reconcileFiber.pollUnsafe())
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(reconcileFiber)
        })
    )

    it.effect(
      "stops a recovery start without blocking reconciliation",
      () =>
        Effect.gen(function* () {
          const state = yield* RelayStateStore
          const config = loadConfig({
            KILN_RELAY_CRASH_RETRY_DELAY_SECONDS: "0",
            NODE_ENV: "test",
          })
          const startBegan = yield* Deferred.make<void>()
          const releaseStart = yield* Deferred.make<void>()
          const stopBegan = yield* Deferred.make<void>()
          const releaseStop = yield* Deferred.make<void>()
          let stoppedService: string | null = null
          const manager = new RuntimeRecoveryManager(
            config,
            state,
            () =>
              Deferred.succeed(startBegan, undefined).pipe(
                Effect.andThen(Deferred.await(releaseStart))
              ),
            Date.now,
            (service) =>
              Effect.sync(() => {
                stoppedService = service
              }).pipe(
                Effect.andThen(Deferred.succeed(stopBegan, undefined)),
                Effect.andThen(Deferred.await(releaseStop))
              )
          )
          yield* manager.initialize()

          const instanceId = "c".repeat(40)
          const stopped = observation(instanceId, {
            exitCode: 1,
            ready: false,
            running: false,
          })
          yield* manager.recordProvisioned(instanceId, "running", 100)
          yield* manager.reconcile([stopped], 200)
          yield* manager.reconcile([stopped], 201)
          yield* Deferred.await(startBegan)

          yield* manager.recordPowerAction(instanceId, "stop", 202)
          yield* Deferred.succeed(releaseStart, undefined)
          yield* Deferred.await(stopBegan)

          const reconcileFiber = yield* manager
            .reconcile([observation(instanceId)], 203)
            .pipe(Effect.forkChild)
          yield* Effect.yieldNow
          assert.isDefined(reconcileFiber.pollUnsafe())
          yield* Fiber.join(reconcileFiber)
          yield* Deferred.succeed(releaseStop, undefined)

          assert.strictEqual(stoppedService, "kiln-cccccccc")
          assert.deepStrictEqual(manager.snapshot(instanceId), {
            desiredState: "stopped",
            recovery: null,
          })
          assert.strictEqual(
            (yield* state.getRuntimeRecovery(instanceId))?.desiredState,
            "stopped"
          )
        })
    )

    it.effect("requeues a failed stop while stopped intent is still running", () =>
      Effect.gen(function* () {
        const state = yield* RelayStateStore
        const config = loadConfig({
          KILN_RELAY_CRASH_RETRY_DELAY_SECONDS: "0",
          NODE_ENV: "test",
        })
        const startBegan = yield* Deferred.make<void>()
        const releaseStart = yield* Deferred.make<void>()
        const attempts = yield* Ref.make(0)
        const firstFailed = yield* Deferred.make<void>()
        const retried = yield* Deferred.make<void>()
        const stopContainer = () =>
          Ref.updateAndGet(attempts, (count) => count + 1).pipe(
            Effect.flatMap((attempt) =>
              attempt === 1
                ? Deferred.succeed(firstFailed, undefined).pipe(
                    Effect.andThen(Effect.fail(new Error("Docker stop failed")))
                  )
                : Deferred.succeed(retried, undefined)
            )
          )
        const manager = new RuntimeRecoveryManager(
          config,
          state,
          () =>
            Deferred.succeed(startBegan, undefined).pipe(
              Effect.andThen(Deferred.await(releaseStart))
            ),
          Date.now,
          stopContainer
        )
        yield* manager.initialize()

        const instanceId = "d".repeat(40)
        const unexpectedlyRunning = observation(instanceId)
        const stopped = observation(instanceId, {
          exitCode: 1,
          ready: false,
          running: false,
        })
        yield* manager.recordProvisioned(instanceId, "running", 100)
        yield* manager.reconcile([stopped], 200)
        yield* manager.reconcile([stopped], 201)
        yield* Deferred.await(startBegan)
        yield* manager.recordPowerAction(instanceId, "stop", 202)
        yield* Deferred.succeed(releaseStart, undefined)
        yield* Deferred.await(firstFailed)
        yield* Effect.yieldNow
        assert.strictEqual(yield* Ref.get(attempts), 1)
        assert.isTrue(
          (yield* state.getRuntimeRecovery(instanceId))?.stopPending === true
        )

        const restartedManager = new RuntimeRecoveryManager(
          config,
          state,
          undefined,
          Date.now,
          stopContainer
        )
        yield* restartedManager.initialize()
        yield* restartedManager.reconcile([unexpectedlyRunning], 203)
        yield* Deferred.await(retried)
        assert.strictEqual(yield* Ref.get(attempts), 2)
        assert.deepStrictEqual(restartedManager.snapshot(instanceId), {
          desiredState: "stopped",
          recovery: null,
        })
        yield* Effect.yieldNow
        yield* restartedManager.reconcile([stopped], 204)
        assert.isTrue(
          (yield* state.getRuntimeRecovery(instanceId))?.stopPending === false
        )
      })
    )

    it.effect("bounds an unconfirmed Docker start with the retry budget", () =>
      Effect.gen(function* () {
        const state = yield* RelayStateStore
        const config = loadConfig({
          KILN_RELAY_CRASH_RETRY_DELAY_SECONDS: "0",
          KILN_RELAY_CRASH_RETRY_LIMIT: "2",
          NODE_ENV: "test",
        })
        const starts = yield* Ref.make(0)
        let currentTime = 100
        const manager = new RuntimeRecoveryManager(
          config,
          state,
          () => Ref.update(starts, (count) => count + 1),
          () => currentTime
        )
        yield* manager.initialize()

        const instanceId = "9".repeat(40)
        const stopped = observation(instanceId, {
          exitCode: 1,
          ready: false,
          running: false,
        })
        yield* manager.recordProvisioned(instanceId, "running", currentTime)
        currentTime = 200
        yield* manager.reconcile([stopped], currentTime)
        currentTime = 201
        const restarting = yield* manager.reconcile([stopped], currentTime)
        yield* Effect.yieldNow

        const confirmationAt = Date.parse(
          restarting.get(instanceId)?.recovery?.nextAttemptAt ?? ""
        )
        assert.isAbove(confirmationAt, currentTime)
        currentTime = confirmationAt - 1
        yield* manager.reconcile([stopped], currentTime)
        assert.strictEqual(yield* Ref.get(starts), 1)

        currentTime = confirmationAt
        const retry = yield* manager.reconcile([stopped], currentTime)
        assert.deepInclude(retry.get(instanceId)?.recovery, {
          attempt: 2,
          phase: "pending",
          reason: "start_failed",
        })
        assert.strictEqual(yield* Ref.get(starts), 1)
      })
    )
  })
})
