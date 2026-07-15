import { execFile } from "node:child_process"
import { promisify } from "node:util"

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
  const result = await executeFile(executable, arguments_, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: options.timeout ?? 30_000,
  })

  return { stderr: result.stderr, stdout: result.stdout }
}
