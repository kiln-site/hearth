export type SensitiveTextRedaction = {
  from: number
  to: number
  replacement: string
}

export function findSensitiveTextRedactions(
  value: string
): Array<SensitiveTextRedaction> {
  const redactions: Array<SensitiveTextRedaction> = []

  for (const match of value.matchAll(
    /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/gu
  )) {
    const start = match.index
    for (const segment of match[0].matchAll(/\d+/gu)) {
      redactions.push({
        from: start + segment.index,
        to: start + segment.index + segment[0].length,
        replacement: "***",
      })
    }
  }

  for (const match of value.matchAll(
    /(?<![\w:])(?:[a-f\d]{0,4}:){2,7}[a-f\d]{0,4}(?![\w:])/giu
  )) {
    const candidate = match[0]
    if (!candidate.includes("::") && candidate.split(":").length - 1 < 5) {
      continue
    }
    const start = match.index
    for (const segment of candidate.matchAll(/[a-f\d]+/giu)) {
      redactions.push({
        from: start + segment.index,
        to: start + segment.index + segment[0].length,
        replacement: "*".repeat(segment[0].length),
      })
    }
  }

  return redactions.sort((left, right) => left.from - right.from)
}

export function redactSensitiveText(value: string): string {
  const redactions = findSensitiveTextRedactions(value)
  if (!redactions.length) return value

  let cursor = 0
  let redacted = ""
  for (const segment of redactions) {
    if (segment.from < cursor) continue
    redacted += value.slice(cursor, segment.from)
    redacted += segment.replacement
    cursor = segment.to
  }
  return redacted + value.slice(cursor)
}
