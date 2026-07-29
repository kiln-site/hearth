import type { RelayAuditRecord } from "@workspace/contracts"
import { z } from "zod"

export const activityTypes = [
  "server",
  "power",
  "console",
  "files",
  "network",
  "access",
  "relay",
  "updates",
  "system",
] as const

export type ActivityType = (typeof activityTypes)[number]

const activityTypeValues: ReadonlySet<string> = new Set(activityTypes)

export function isActivityType(value: string): value is ActivityType {
  return activityTypeValues.has(value)
}

export const activityInstantSchema = z.iso.datetime()

export interface ActivityScope {
  allInstances: boolean
  instanceIds: ReadonlySet<string>
}

export function auditInstanceId(audit: RelayAuditRecord): string | null {
  return typeof audit.details.instanceId === "string"
    ? audit.details.instanceId
    : null
}

export function scopeAllowsAudit(
  scope: ActivityScope,
  audit: RelayAuditRecord
): boolean {
  if (scope.allInstances) return true
  const instanceId = auditInstanceId(audit)
  return instanceId !== null && scope.instanceIds.has(instanceId)
}

export function activityLocalRangeToUtc(
  from: Date,
  to: Date
): { from: string; to: string } {
  const start = new Date(from)
  start.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(23, 59, 59, 999)
  return {
    from: start.toISOString(),
    to: end.toISOString(),
  }
}

export function activityTypeForAudit(audit: RelayAuditRecord): ActivityType {
  const operation = auditOperation(audit)
  if (
    audit.event === "browser.console.write" ||
    operation === "instance.console.write"
  ) {
    return "console"
  }
  if (
    audit.event.startsWith("browser.file.") ||
    operation === "instance.files.write"
  ) {
    return "files"
  }
  if (operation === "instance.action") return "power"
  if (
    operation?.startsWith("instance.network.") ||
    operation?.startsWith("relay.networking.") ||
    operation?.startsWith("relay.proxy.") ||
    operation?.startsWith("relay.tailscale.")
  ) {
    return "network"
  }
  if (
    operation?.startsWith("instance.") ||
    audit.event.startsWith("instance.")
  ) {
    return "server"
  }
  if (
    audit.event.includes("invitation") ||
    audit.event.includes("client.") ||
    operation?.startsWith("relay.pairing.") ||
    operation?.startsWith("relay.clients.")
  ) {
    return "access"
  }
  if (
    audit.event.includes("update") ||
    operation?.startsWith("relay.update.")
  ) {
    return "updates"
  }
  if (audit.event.startsWith("relay.") || operation?.startsWith("relay.")) {
    return "relay"
  }
  return "system"
}

export function activityLabelForAudit(audit: RelayAuditRecord): string {
  const operation = auditOperation(audit)
  if (audit.event === "browser.console.write") return "Sent a console command"
  if (audit.event === "browser.file.upload") return "Uploaded a file"
  if (audit.event === "browser.file.download") return "Downloaded a file"
  if (audit.event === "relay.client.paired") return "Paired a Hearth client"
  if (audit.event === "system.update_started") return "Started a system update"
  if (audit.event === "invitation.created") {
    return "Created a Relay invitation"
  }
  if (audit.event === "invitation.revoked") {
    return "Revoked a Relay invitation"
  }
  if (audit.event === "client.policy_changed") {
    return "Changed a Hearth client policy"
  }
  if (audit.event === "client.revoked") return "Revoked a Hearth client"
  if (audit.event === "relay.renamed") return "Renamed a Relay"

  if (operation === "instance.action") {
    const action = audit.details.action
    if (action === "start") return "Started a server"
    if (action === "restart") return "Restarted a server"
    if (action === "stop") return "Stopped a server"
    if (action === "kill") return "Killed a server process"
    return "Changed a server power state"
  }
  if (operation === "instance.create") return "Created a server"
  if (operation === "instance.delete") return "Deleted a server"
  if (operation === "instance.rename") return "Renamed a server"
  if (operation === "instance.startup.write") {
    return "Updated server startup settings"
  }
  if (operation === "instance.files.write") return "Saved a server file"
  if (operation === "instance.console.write") return "Sent a console command"
  if (operation === "instance.network.routes.write") {
    return "Updated server network routes"
  }
  if (operation === "relay.rename") return "Renamed a Relay"
  if (operation === "relay.proxy.write") return "Updated Relay proxy settings"
  if (operation === "relay.networking.write") {
    return "Updated Relay networking"
  }
  if (operation === "relay.tailscale.install") return "Installed Tailscale"
  if (operation === "relay.tailscale.write") {
    return "Updated Tailscale settings"
  }
  if (operation === "relay.tailscale.stack.apply") {
    return "Applied a Tailscale stack"
  }
  if (operation === "relay.tailscale.stack.dns") {
    return "Updated Tailscale DNS"
  }
  if (operation === "relay.tailscale.stack.remove") {
    return "Removed a Tailscale stack"
  }
  if (operation === "relay.update.apply") return "Applied a Relay update"
  if (operation === "relay.pairing.create") {
    return "Created a Relay invitation"
  }
  if (operation === "relay.pairing.revoke") {
    return "Revoked a Relay invitation"
  }
  if (operation === "relay.clients.update") {
    return "Changed a Hearth client policy"
  }
  if (operation === "relay.clients.revoke") {
    return "Revoked a Hearth client"
  }

  return humanizeEvent(operation ?? audit.event)
}

export function auditUserId(audit: RelayAuditRecord): string | null {
  return typeof audit.details.subject === "string"
    ? audit.details.subject
    : null
}

function auditOperation(audit: RelayAuditRecord): string | null {
  return typeof audit.details.operation === "string"
    ? audit.details.operation
    : null
}

function humanizeEvent(value: string): string {
  const words = value
    .split(/[._-]/u)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
  if (words.length === 0) return "Recorded activity"
  const [first, ...rest] = words
  return `${first?.charAt(0).toUpperCase()}${first?.slice(1)} ${rest.join(" ")}`.trim()
}
