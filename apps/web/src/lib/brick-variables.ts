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
  return Object.fromEntries(
    Object.entries(brick.variables).flatMap(([name, definition]) =>
      definition.default === undefined ? [] : [[name, definition.default]]
    )
  )
}

export function defaultBrickInstanceName(brick: Brick): string {
  const version = Object.hasOwn(brick.variables, "version")
    ? brick.variables.version.default
    : undefined
  return `${brick.metadata.name}${version === undefined ? "" : ` ${String(version)}`}`
}
