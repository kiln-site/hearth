import { z } from "zod"

import { commandError } from "./errors.js"

export interface CliArguments {
  command: Array<string>
  follow: boolean
  help: boolean
  limit: number
  name?: string
  noOpen: boolean
  profile?: string
  token?: string
  url?: string
  version: boolean
}

export function parseArguments(argv: Array<string>): CliArguments {
  const command: Array<string> = []
  let follow = false
  let help = false
  let limit = 2_000
  let name: string | undefined
  let noOpen = false
  let profile: string | undefined
  let token: string | undefined
  let url: string | undefined
  let version = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument) continue
    const [flag, inlineValue] = argument.split("=", 2)
    const value = () => {
      if (inlineValue !== undefined) return inlineValue
      const next = argv[index + 1]
      if (!next || next.startsWith("--")) {
        throw commandError({
          code: "invalid_arguments",
          exitCode: 2,
          message: `${flag} requires a value.`,
        })
      }
      index += 1
      return next
    }
    if (flag === "--follow" || flag === "-f") follow = true
    else if (flag === "--help" || flag === "-h") help = true
    else if (flag === "--no-open") noOpen = true
    else if (flag === "--version" || flag === "-v") version = true
    else if (flag === "--limit") {
      const parsed = z.coerce
        .number()
        .int()
        .min(1)
        .max(10_000)
        .safeParse(value())
      if (!parsed.success) {
        throw commandError({
          code: "invalid_arguments",
          exitCode: 2,
          message: "--limit must be an integer from 1 to 10000.",
        })
      }
      limit = parsed.data
    } else if (flag === "--name") name = value()
    else if (flag === "--profile") profile = value()
    else if (flag === "--token") token = value()
    else if (flag === "--url") url = value()
    else if (argument.startsWith("-")) {
      throw commandError({
        code: "invalid_arguments",
        exitCode: 2,
        message: `Unknown option: ${argument}`,
      })
    } else command.push(argument)
  }
  return {
    command,
    follow,
    help,
    limit,
    ...(name ? { name } : {}),
    noOpen,
    ...(profile ? { profile } : {}),
    ...(token ? { token } : {}),
    ...(url ? { url } : {}),
    version,
  }
}
