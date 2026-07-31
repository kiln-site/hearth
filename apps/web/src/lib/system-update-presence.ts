import { Option, Result, Schema } from "effect"

type SystemUpdatePresence = {
  component: "hearth" | "relay"
  operationId: string
  relayId: string
}

export const activeSystemUpdateStorageKey = "kiln.active-system-update"

const hearthOperations = new Set<string>()
const relayOperations = new Map<string, Set<string>>()
const relayDisconnects = new Set<string>()
const relayStatusDuringUpdate = new Map<string, "connected" | "unreachable">()
let hydrated = false
const decodeStoredPresence = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Unknown)
)

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
  if (operations.size > 0) return

  relayOperations.delete(update.relayId)
  if (relayStatusDuringUpdate.get(update.relayId) === "connected") {
    relayDisconnects.delete(update.relayId)
  }
  relayStatusDuringUpdate.delete(update.relayId)
}

export function isHearthSystemUpdateActive(): boolean {
  return hearthOperations.size > 0
}

export function isRelaySystemUpdateActive(relayId: string): boolean {
  return (relayOperations.get(relayId)?.size ?? 0) > 0
}

export function noteRelayDisconnectedDuringUpdate(relayId: string): void {
  relayDisconnects.add(relayId)
  relayStatusDuringUpdate.set(relayId, "unreachable")
}

export function noteRelayReconnectedDuringUpdate(relayId: string): void {
  relayStatusDuringUpdate.set(relayId, "connected")
}

export function consumeRelayUpdateReconnect(relayId: string): boolean {
  relayStatusDuringUpdate.delete(relayId)
  return relayDisconnects.delete(relayId)
}

export function relayDisconnectToastId(relayId: string): string {
  return `relay-disconnected:${relayId}`
}

export function relayReconnectToastId(relayId: string): string {
  return `relay-reconnected:${relayId}`
}

export function hydrateSystemUpdatePresence(): void {
  if (hydrated || typeof window === "undefined") return
  hydrated = true
  const stored = Result.try(() =>
    window.localStorage.getItem(activeSystemUpdateStorageKey)
  ).pipe(Result.getOrNull)
  if (!stored) return
  const parsed = decodeStoredPresence(stored)
  if (Option.isNone(parsed)) {
    Result.try(() =>
      window.localStorage.removeItem(activeSystemUpdateStorageKey)
    )
    return
  }
  const values = Array.isArray(parsed.value) ? parsed.value : [parsed.value]
  for (const value of values) {
    if (
      typeof value !== "object" ||
      value === null ||
      !("component" in value) ||
      (value.component !== "hearth" && value.component !== "relay") ||
      !("operationId" in value) ||
      typeof value.operationId !== "string" ||
      !("relayId" in value) ||
      typeof value.relayId !== "string"
    ) {
      continue
    }
    markSystemUpdateActive({
      component: value.component,
      operationId: value.operationId,
      relayId: value.relayId,
    })
  }
}

hydrateSystemUpdatePresence()
