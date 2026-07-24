import type { RelayInstance } from "@workspace/contracts"

import type { RelayStoredInstanceName } from "./effect/state.js"

export function applyStoredInstanceNames(
  instances: ReadonlyArray<RelayInstance>,
  storedNames: ReadonlyArray<RelayStoredInstanceName>
): Array<RelayInstance> {
  const names = new Map(
    storedNames.map((stored) => [stored.instanceId, stored.name])
  )
  return instances.map((instance) => ({
    ...instance,
    name: names.get(instance.id) ?? instance.name,
  }))
}
