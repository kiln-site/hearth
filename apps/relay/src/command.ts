import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { Effect } from "effect"

import { CommandError } from "./effect/errors.js"
import { runRelayEffect } from "./effect/runtime.js"

const executeFile = promisify(execFile)

export interface CommandResult {
  stderr: string
  stdout: string
}

export async function command(
  executable: string,
  arguments_: Array<string>,
  options: { cwd?: string; timeout?: number } = {}
): Promise<CommandResult> {
  return runRelayEffect(
    "command.execute",
    commandEffect(executable, arguments_, options)
  )
}

export const commandEffect = Effect.fn("command.execute")(function* (
  executable: string,
  arguments_: Array<string>,
  options: { cwd?: string; timeout?: number } = {}
) {
  const result = yield* Effect.tryPromise({
    try: () =>
      executeFile(executable, arguments_, {
        cwd: options.cwd,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        timeout: options.timeout ?? 30_000,
      }),
    catch: (cause) =>
      CommandError.make({
        executable,
        message:
          cause instanceof Error ? cause.message : `${executable} failed`,
        cause,
      }),
  })

  return { stderr: result.stderr, stdout: result.stdout }
})
