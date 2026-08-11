import { Effect } from "effect"

import type { CliCommandError } from "./errors.js"
import { reportErrorCauseEffect } from "./output.js"

export interface CliSignalSource {
  on(signal: NodeJS.Signals, listener: () => void): unknown
  off(signal: NodeJS.Signals, listener: () => void): unknown
}

export function runCliProgram(
  program: Effect.Effect<void, CliCommandError>,
  signalSource: CliSignalSource = process,
  onInterrupt: () => void = () => {
    process.exitCode = 130
  }
) {
  const fiber = Effect.runFork(
    program.pipe(Effect.catchCause(reportErrorCauseEffect))
  )
  let active = true
  const interrupt = () => {
    if (!active) return
    active = false
    onInterrupt()
    fiber.interruptUnsafe()
  }
  const cleanup = () => {
    active = false
    signalSource.off("SIGINT", interrupt)
    signalSource.off("SIGTERM", interrupt)
  }

  signalSource.on("SIGINT", interrupt)
  signalSource.on("SIGTERM", interrupt)
  fiber.addObserver(cleanup)
  return fiber
}
