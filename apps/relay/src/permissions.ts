import { Schema } from "effect"

import type { RelayClientRole } from "./effect/state.js"

export const relayActions = [
  "relay.read",
  "relay.rename",
  "relay.configure",
  "relay.audit.read",
  "relay.pairing.create",
  "relay.pairing.list",
  "relay.pairing.revoke",
  "relay.clients.list",
  "relay.clients.update",
  "relay.clients.revoke",
  "brick.read",
  "instance.read",
  "instance.create",
  "instance.delete",
  "instance.rename",
  "instance.power.start",
  "instance.power.stop",
  "instance.power.restart",
  "instance.power.kill",
  "instance.console.read",
  "instance.console.write",
  "instance.sftp.connect",
  "instance.files.list",
  "instance.files.read",
  "instance.files.create",
  "instance.files.write",
  "instance.files.delete",
  "instance.files.rename",
  "instance.files.chmod",
  "instance.files.download",
  "instance.files.upload",
  "instance.network.read",
  "instance.network.write",
  "instance.logs.read",
] as const

export type RelayAction = (typeof relayActions)[number]

export const RelayActionSchema = Schema.Literals(relayActions)

const readOnlyActions = new Set<RelayAction>([
  "relay.read",
  "relay.audit.read",
  "relay.pairing.list",
  "relay.clients.list",
  "brick.read",
  "instance.read",
  "instance.console.read",
  "instance.files.list",
  "instance.files.read",
  "instance.files.download",
  "instance.network.read",
  "instance.logs.read",
])

export function actionsForRole(
  role: RelayClientRole,
  customActions: ReadonlyArray<RelayAction> = []
): ReadonlyArray<RelayAction> {
  if (role === "full_access") return relayActions
  if (role === "read_only") {
    return relayActions.filter((action) => readOnlyActions.has(action))
  }
  return relayActions.filter((action) => customActions.includes(action))
}

export function isActionAllowed(
  grantedActions: ReadonlyArray<string>,
  action: RelayAction
): boolean {
  return grantedActions.includes(action)
}
