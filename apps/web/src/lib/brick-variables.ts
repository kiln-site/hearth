import type { BrickVariableValue } from "@workspace/contracts"

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
