import {
  requiredMinecraftJavaVersion,
  type Brick,
  type BrickVariableValue,
} from "@workspace/contracts"
import { Result } from "effect"

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

export function hydrateBrickVariables(
  brick: Brick,
  stored: Readonly<Record<string, BrickVariableValue>> | null | undefined
): Record<string, BrickVariableValue> {
  const variables = {
    ...defaultBrickVariables(brick),
    ...stored,
  }
  return stored && Object.hasOwn(stored, "java_version")
    ? variables
    : withRecommendedMinecraftJava(
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
    javaDefinition &&
    stringVariableAllows(javaDefinition, javaVersion)
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
  return stringVariableAllows(javaDefinition, javaVersion) ? null : javaVersion
}

function stringVariableAllows(
  definition: Brick["variables"][string],
  value: string
): boolean {
  if (definition.type !== "string") return false
  if (
    definition.options &&
    !definition.options.some((option) => option === value)
  ) {
    return false
  }
  if (
    definition.rules?.minLength !== undefined &&
    value.length < definition.rules.minLength
  ) {
    return false
  }
  if (
    definition.rules?.maxLength !== undefined &&
    value.length > definition.rules.maxLength
  ) {
    return false
  }
  const patternSource = definition.rules?.pattern
  if (!patternSource) return true
  const pattern = Result.try(() => new RegExp(patternSource, "u"))
  return Result.isSuccess(pattern) && pattern.success.test(value)
}

export function defaultBrickInstanceName(brick: Brick): string {
  const version = Object.hasOwn(brick.variables, "version")
    ? brick.variables.version.default
    : undefined
  return `${brick.metadata.name}${version === undefined ? "" : ` ${String(version)}`}`
}
