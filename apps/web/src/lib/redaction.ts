export type SensitiveTextRedaction = {
  from: number
  groupFrom: number
  to: number
  replacement: string
}

export type SensitiveTextRedactionRange = {
  from: number
  to: number
}

export type RedactedSensitiveText = {
  redactions: Array<SensitiveTextRedactionRange>
  text: string
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
        groupFrom: start,
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
        groupFrom: start,
        to: start + segment.index + segment[0].length,
        replacement: "*".repeat(segment[0].length),
      })
    }
  }

  return redactions.sort((left, right) => left.from - right.from)
}

export function redactSensitiveText(value: string): string {
  return redactSensitiveTextWithRanges(value).text
}

export function redactSensitiveTextWithRanges(
  value: string
): RedactedSensitiveText {
  const segments = findSensitiveTextRedactions(value)
  if (!segments.length) return { redactions: [], text: value }

  let cursor = 0
  let redacted = ""
  let activeGroupFrom: number | null = null
  const redactions: Array<SensitiveTextRedactionRange> = []
  for (const segment of segments) {
    if (segment.from < cursor) continue
    redacted += value.slice(cursor, segment.from)
    const replacementFrom = redacted.length
    redacted += segment.replacement
    const activeRedaction = redactions.at(-1)
    if (activeRedaction && activeGroupFrom === segment.groupFrom) {
      activeRedaction.to = redacted.length
    } else {
      redactions.push({ from: replacementFrom, to: redacted.length })
      activeGroupFrom = segment.groupFrom
    }
    cursor = segment.to
  }
  return {
    redactions,
    text: redacted + value.slice(cursor),
  }
}
