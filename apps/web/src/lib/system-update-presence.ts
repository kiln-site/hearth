type SystemUpdatePresence = {
  component: "hearth" | "relay"
  operationId: string
  relayId: string
}

const hearthOperations = new Set<string>()
const relayOperations = new Map<string, Set<string>>()

export const applicationConnectionToastId = "kiln-connection"
export const applicationReconnectedToastId = "kiln-reconnected"

export function markSystemUpdateActive(update: SystemUpdatePresence): void {
  if (update.component === "hearth") {
    hearthOperations.add(update.operationId)
    return
  }

  const operations = relayOperations.get(update.relayId) ?? new Set<string>()
  operations.add(update.operationId)
  relayOperations.set(update.relayId, operations)
}

export function clearSystemUpdateActive(update: SystemUpdatePresence): void {
  if (update.component === "hearth") {
    hearthOperations.delete(update.operationId)
    return
  }

  const operations = relayOperations.get(update.relayId)
  if (!operations) return
  operations.delete(update.operationId)
  if (operations.size === 0) relayOperations.delete(update.relayId)
}

export function isHearthSystemUpdateActive(): boolean {
  return hearthOperations.size > 0
}

export function isRelaySystemUpdateActive(relayId: string): boolean {
  return (relayOperations.get(relayId)?.size ?? 0) > 0
}

export function relayDisconnectToastId(relayId: string): string {
  return `relay-disconnected:${relayId}`
}

export function relayReconnectToastId(relayId: string): string {
  return `relay-reconnected:${relayId}`
}
