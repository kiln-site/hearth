export function requiredMinecraftJavaVersion(
  brickId: string,
  version: string
): string | null {
  const parsed = parseMinecraftVersion(version)
  if (!parsed) return null
  const [major, minor, patch] = parsed

  if (brickId === "paper" || brickId === "folia") {
    if (major === 26 && minor >= 1) return "25"
    if (major !== 1) return null
    if (minor === 20 || minor === 21) return "21"
    if (minor >= 17 && minor <= 19) return "17"
    if (minor === 16 && patch >= 5) return "16"
    if (minor >= 12 && minor <= 16) return "11"
    if (minor >= 7 && minor <= 11) return "8"
    return null
  }

  if (brickId === "fabric") {
    if (major === 26 && minor >= 1) return "25"
    if (major !== 1) return null
    if (minor === 21 || (minor === 20 && patch >= 5)) return "21"
    if (minor >= 17 && minor <= 20) return "17"
    if (minor >= 1 && minor <= 16) return "8"
  }

  return null
}

function parseMinecraftVersion(
  version: string
): readonly [major: number, minor: number, patch: number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?$/u)
  if (!match?.[1] || !match[2]) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3] ?? 0)
  return [major, minor, patch].every(Number.isSafeInteger)
    ? [major, minor, patch]
    : null
}
