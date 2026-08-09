import { Effect } from "effect"

import type { CliCommandError } from "./errors.js"

export type OutputMode = "human" | "json"

export function writeResult(value: unknown, mode: OutputMode): void {
  process.stdout.write(
    mode === "json" ? `${JSON.stringify(value)}\n` : `${humanize(value)}\n`
  )
}

export function writeEvent(value: unknown, mode: OutputMode): void {
  writeResult(value, mode)
}

export const reportErrorEffect = Effect.fn("cli.output.error")(function* (
  cause: CliCommandError,
  mode: OutputMode
) {
  yield* Effect.sync(() => {
    process.stderr.write(
      mode === "json"
        ? `${JSON.stringify({
            error: {
              code: cause.code,
              message: cause.message,
              retryable: cause.retryable,
            },
          })}\n`
        : `Error: ${cause.message}\n`
    )
    process.exitCode = cause.exitCode
  })
})

function humanize(value: unknown): string {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return String(value)
  return JSON.stringify(value, null, 2)
}
