export function compareReleaseVersions(
  left: string,
  right: string | null,
  publishedAtByVersion: ReadonlyMap<string, string | null>
): -1 | 0 | 1 {
  if (!right) return 1
  if (left === right) return 0
  const leftParts = versionParts(left)
  const rightParts = versionParts(right)

  for (let index = 0; index < 3; index += 1) {
    const difference =
      (leftParts.numbers[index] ?? 0) - (rightParts.numbers[index] ?? 0)
    if (difference !== 0) return difference < 0 ? -1 : 1
  }

  if (leftParts.nightly !== null && rightParts.nightly !== null) {
    return compareNumbers(leftParts.nightly, rightParts.nightly)
  }
  if (leftParts.nightly === null && rightParts.nightly === null) return 0

  const publishedComparison = comparePublishedAt(
    publishedAtByVersion.get(left),
    publishedAtByVersion.get(right)
  )
  if (publishedComparison !== null) return publishedComparison

  return leftParts.nightly === null ? 1 : -1
}

export function isKilnReleaseVersion(
  version: string | null
): version is string {
  return (
    version !== null && /^0\.\d+\.\d+(?:-nightly\.\d+)?$/u.test(version.trim())
  )
}

export function compareLatestReleaseVersion(
  currentVersion: string | null,
  releases: ReadonlyArray<{
    publishedAt: string | null
    version: string
  }>
): -1 | 0 | 1 | null {
  const latestRelease = releases[0]
  if (!latestRelease || !isKilnReleaseVersion(currentVersion)) return null
  if (latestRelease.version === currentVersion) return 0

  const currentReleaseIndex = releases.findIndex(
    (release) => release.version === currentVersion
  )
  if (currentReleaseIndex > 0) return 1

  const publishedAtByVersion = new Map(
    releases.map((release) => [release.version, release.publishedAt])
  )
  const comparison = compareReleaseVersions(
    latestRelease.version,
    currentVersion,
    publishedAtByVersion
  )

  // The feed's first entry is authoritative for the latest-only policy. A
  // stable and nightly build can share a numeric version even when the older
  // build is no longer present in GitHub's retained release window.
  if (
    comparison === -1 &&
    releaseVersionCore(latestRelease.version) ===
      releaseVersionCore(currentVersion)
  ) {
    return 1
  }
  return comparison
}

function versionParts(version: string): {
  nightly: number | null
  numbers: [number, number, number]
} {
  const match = /^0\.(\d+)\.(\d+)(?:-nightly\.(\d+))?$/u.exec(version.trim())
  if (!match) return { nightly: null, numbers: [0, 0, 0] }
  return {
    nightly: match[3] === undefined ? null : Number(match[3]),
    numbers: [0, Number(match[1]), Number(match[2])],
  }
}

function releaseVersionCore(version: string): string {
  return version.replace(/-nightly\.\d+$/u, "")
}

function comparePublishedAt(
  left: string | null | undefined,
  right: string | null | undefined
): -1 | 0 | 1 | null {
  if (!left || !right) return null
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return null
  return compareNumbers(leftTime, rightTime)
}

function compareNumbers(left: number, right: number): -1 | 0 | 1 {
  if (left === right) return 0
  return left < right ? -1 : 1
}
