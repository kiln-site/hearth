import { basename } from "node:path"

import { MINIMUM_INSTANCE_DISK_LIMIT_BYTES } from "@workspace/contracts"
import { Result } from "effect"

import { commandError } from "./errors.js"

export function parseDiskBytes(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const match = /^(\d+(?:\.\d+)?)\s*(B|KIB|MIB|GIB|TIB|KB|MB|GB|TB)$/iu.exec(
    value.trim()
  )
  const amount = Number(match?.[1])
  const unit = match?.[2]?.toUpperCase()
  const multiplier =
    unit === "B"
      ? 1
      : unit === "KB"
        ? 1_000
        : unit === "MB"
          ? 1_000 ** 2
          : unit === "GB"
            ? 1_000 ** 3
            : unit === "TB"
              ? 1_000 ** 4
              : unit === "KIB"
                ? 1_024
                : unit === "MIB"
                  ? 1_024 ** 2
                  : unit === "GIB"
                    ? 1_024 ** 3
                    : unit === "TIB"
                      ? 1_024 ** 4
                      : 0
  const bytes = Math.round(amount * multiplier)
  if (!match || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw invalidInput(
      "--disk must be a positive size with a unit, such as 25GiB."
    )
  }
  if (bytes < MINIMUM_INSTANCE_DISK_LIMIT_BYTES) {
    throw invalidInput("--disk must be at least 0.1GiB.")
  }
  return bytes
}

export function parseMemoryVariable(
  value: string | undefined
): string | undefined {
  if (value === undefined) return undefined
  const match = /^(\d+)\s*(M|G|MIB|GIB)$/iu.exec(value.trim())
  if (!match?.[1] || !match[2]) {
    throw invalidInput(
      "--memory must use whole mebibytes or gibibytes, such as 4096M or 4GiB."
    )
  }
  const unit = match[2].toUpperCase()
  return `${match[1]}${unit.startsWith("G") ? "G" : "M"}`
}

export function parseVariableAssignments(
  assignments: ReadonlyArray<string>
): Record<string, string | number | boolean> {
  const variables: Record<string, string | number | boolean> = {}
  for (const assignment of assignments) {
    const separator = assignment.indexOf("=")
    const name = assignment.slice(0, separator).trim()
    const input = assignment.slice(separator + 1)
    if (separator <= 0 || !/^[A-Za-z][A-Za-z\d_]{0,119}$/u.test(name)) {
      throw invalidInput(
        "--variable values use name=value with an alphanumeric or underscore name."
      )
    }
    variables[name] = input.startsWith("json:")
      ? parseJsonVariable(name, input.slice(5))
      : input
  }
  return variables
}

export function remoteFileBasename(source: string): string | null {
  return Result.try(() => {
    const url = new URL(source)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    const name = basename(decodeURIComponent(url.pathname))
    return name && name !== "/" ? name : null
  }).pipe(Result.getOrNull)
}

function parseJsonVariable(
  name: string,
  value: string
): string | number | boolean {
  const parsed: unknown = Result.try(() => JSON.parse(value)).pipe(
    Result.getOrThrowWith(() =>
      invalidInput(`--variable ${name} contains invalid JSON.`)
    )
  )
  if (
    typeof parsed !== "string" &&
    typeof parsed !== "number" &&
    typeof parsed !== "boolean"
  ) {
    throw invalidInput(
      `--variable ${name} JSON must be a string, number, or boolean.`
    )
  }
  return parsed
}

function invalidInput(message: string) {
  return commandError({
    code: "invalid_arguments",
    exitCode: 2,
    message,
  })
}
