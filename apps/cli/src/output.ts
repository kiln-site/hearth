import { Effect } from "effect"

import type { CliCommandError } from "./errors.js"

export function writeLine(value = ""): void {
  process.stdout.write(`${value}\n`)
}

export function writeText(value: string): void {
  process.stdout.write(value)
}

export const reportErrorEffect = Effect.fn("cli.output.error")(function* (
  cause: CliCommandError
) {
  yield* Effect.sync(() => {
    process.stderr.write(`Error: ${cause.message}\n`)
    process.exitCode = cause.exitCode
  })
})

export function renderTable(
  headings: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>
): string {
  const normalizedRows = [headings, ...rows].map((row) =>
    row.map(normalizeCell)
  )
  const widths = headings.map((_, column) =>
    Math.max(...normalizedRows.map((row) => row[column]?.length ?? 0))
  )
  return normalizedRows
    .map((row) =>
      row
        .map((cell, column) =>
          column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)
        )
        .join("  ")
        .trimEnd()
    )
    .join("\n")
}

export function writeTable(
  headings: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>
): void {
  writeLine(renderTable(headings, rows))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  const units = ["KiB", "MiB", "GiB", "TiB"]
  let value = bytes / 1_024
  let unit = 0
  while (value >= 1_024 && unit < units.length - 1) {
    value /= 1_024
    unit += 1
  }
  const precision = value >= 10 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unit]}`
}

function normalizeCell(value: string): string {
  return value.replace(/[\r\n\t]+/gu, " ")
}
