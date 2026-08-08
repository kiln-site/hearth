import type {
  Brick,
  BrickVariableValue,
} from "@workspace/contracts"

export function updateBrickVariable(
  variables: Readonly<Record<string, BrickVariableValue>>,
  name: string,
  value: BrickVariableValue | undefined
): Record<string, BrickVariableValue> {
  const updated = { ...variables }
  if (value === undefined) delete updated[name]
  else updated[name] = value
  return updated
}

export function defaultBrickVariables(
  brick: Brick
): Record<string, BrickVariableValue> {
  const variables = Object.fromEntries(
    Object.entries(brick.variables).flatMap(([name, definition]) =>
      definition.default === undefined ? [] : [[name, definition.default]]
    )
  )
  return withRecommendedMinecraftJava(
    brick.metadata.id,
    brick.variables,
    variables
  )
}

export function withRecommendedMinecraftJava(
  brickId: string,
  definitions: Brick["variables"],
  variables: Readonly<Record<string, BrickVariableValue>>
): Record<string, BrickVariableValue> {
  const updated = { ...variables }
  const version = variables.version
  const javaVersion =
    typeof version === "string"
      ? requiredMinecraftJavaVersion(brickId, version)
      : null
  const javaDefinition = definitions.java_version
  if (
    javaVersion &&
    javaDefinition?.type === "string" &&
    (!javaDefinition.options ||
      javaDefinition.options.some((option) => option === javaVersion))
  ) {
    updated.java_version = javaVersion
  }
  return updated
}

export function unavailableMinecraftJavaVersion(
  brickId: string,
  definitions: Brick["variables"],
  version: string
): string | null {
  const javaVersion = requiredMinecraftJavaVersion(brickId, version)
  const javaDefinition = definitions.java_version
  if (!javaVersion || javaDefinition?.type !== "string") return null
  return javaDefinition.options?.some((option) => option === javaVersion)
    ? null
    : javaVersion
}

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
  const parsed = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3] ?? 0),
  ] as const
  return parsed.every(Number.isSafeInteger) ? parsed : null
}

export function defaultBrickInstanceName(brick: Brick): string {
  const version = Object.hasOwn(brick.variables, "version")
    ? brick.variables.version.default
    : undefined
  return `${brick.metadata.name}${version === undefined ? "" : ` ${String(version)}`}`
}
