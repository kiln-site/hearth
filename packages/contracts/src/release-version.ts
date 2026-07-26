export type KilnReleaseVersionOrder = -1 | 0 | 1

type ParsedKilnReleaseVersion = {
  core: readonly [number, number, number]
  nightly: number | null
}

const kilnReleaseVersionPattern = /^(0)\.(\d+)\.(\d+)(?:-nightly\.(\d+))?$/u

export function isKilnReleaseVersion(
  version: string | null | undefined
): version is string {
  return (
    version !== null &&
    version !== undefined &&
    kilnReleaseVersionPattern.test(version.trim())
  )
}

export function isKilnNightlyVersion(version: string): boolean {
  const parsedVersion = parseKilnReleaseVersion(version)
  return parsedVersion !== null && parsedVersion.nightly !== null
}

export function kilnReleaseVersionCore(version: string): string {
  return version.replace(/-nightly\.\d+$/u, "")
}

export function compareKilnReleaseVersions(
  left: string,
  right: string
): KilnReleaseVersionOrder | null {
  const leftVersion = parseKilnReleaseVersion(left)
  const rightVersion = parseKilnReleaseVersion(right)
  if (!leftVersion || !rightVersion) return null

  for (let index = 0; index < leftVersion.core.length; index += 1) {
    const difference =
      (leftVersion.core[index] ?? 0) - (rightVersion.core[index] ?? 0)
    if (difference !== 0) return difference < 0 ? -1 : 1
  }

  if (leftVersion.nightly !== null && rightVersion.nightly !== null) {
    return compareNumbers(leftVersion.nightly, rightVersion.nightly)
  }
  if (leftVersion.nightly === null && rightVersion.nightly === null) return 0
  return leftVersion.nightly === null ? 1 : -1
}

function parseKilnReleaseVersion(
  version: string
): ParsedKilnReleaseVersion | null {
  const match = kilnReleaseVersionPattern.exec(version.trim())
  if (!match) return null
  return {
    core: [Number(match[1] ?? 0), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    nightly: match[4] === undefined ? null : Number(match[4]),
  }
}

function compareNumbers(left: number, right: number): KilnReleaseVersionOrder {
  if (left === right) return 0
  return left < right ? -1 : 1
}
