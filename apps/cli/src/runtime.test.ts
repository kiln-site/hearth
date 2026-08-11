import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"

import { runCliProgram, type CliSignalSource } from "./runtime.js"

class TestSignalSource implements CliSignalSource {
  readonly listeners = new Map<NodeJS.Signals, Set<() => void>>()

  on(signal: NodeJS.Signals, listener: () => void): void {
    const listeners = this.listeners.get(signal) ?? new Set()
    listeners.add(listener)
    this.listeners.set(signal, listeners)
  }

  off(signal: NodeJS.Signals, listener: () => void): void {
    this.listeners.get(signal)?.delete(listener)
  }

  emit(signal: NodeJS.Signals): void {
    this.listeners.get(signal)?.forEach((listener) => listener())
  }

  listenerCount(signal: NodeJS.Signals): number {
    return this.listeners.get(signal)?.size ?? 0
  }
}

describe("CLI runtime", () => {
  it.effect("interrupts once and removes signal listeners", () =>
    Effect.gen(function* () {
      const signals = new TestSignalSource()
      let interrupts = 0
      const fiber = runCliProgram(Effect.never, signals, () => {
        interrupts += 1
      })

      assert.strictEqual(signals.listenerCount("SIGINT"), 1)
      assert.strictEqual(signals.listenerCount("SIGTERM"), 1)
      signals.emit("SIGINT")
      yield* Fiber.await(fiber)
      signals.emit("SIGTERM")

      assert.strictEqual(interrupts, 1)
      assert.strictEqual(signals.listenerCount("SIGINT"), 0)
      assert.strictEqual(signals.listenerCount("SIGTERM"), 0)
    })
  )

  it.effect("removes signal listeners after normal completion", () =>
    Effect.gen(function* () {
      const signals = new TestSignalSource()
      const fiber = runCliProgram(Effect.void, signals)
      yield* Fiber.await(fiber)

      assert.strictEqual(signals.listenerCount("SIGINT"), 0)
      assert.strictEqual(signals.listenerCount("SIGTERM"), 0)
    })
  )
})
