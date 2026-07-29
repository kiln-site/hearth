import { describe, expect, it } from "vite-plus/test"
import type { RelayAuditRecord } from "@workspace/contracts"

import {
  activityLabelForAudit,
  activityTypeForAudit,
  scopeAllowsAudit,
} from "@/lib/activity"

function audit(
  details: RelayAuditRecord["details"],
  event = "control.mutation"
): RelayAuditRecord {
  return {
    clientId: "hearth",
    details,
    event,
    id: "audit",
    occurredAt: 1,
    requestId: "request",
  }
}

describe("activity", () => {
  it("never exposes unknown or other-server scope to an instance-only user", () => {
    const scope = {
      allInstances: false,
      instanceIds: new Set(["server-a"]),
    }

    expect(scopeAllowsAudit(scope, audit({ operation: "relay.rename" }))).toBe(
      false
    )
    expect(
      scopeAllowsAudit(
        scope,
        audit({ instanceId: "server-b", operation: "instance.rename" })
      )
    ).toBe(false)
    expect(
      scopeAllowsAudit(
        scope,
        audit({ instanceId: "server-a", operation: "instance.rename" })
      )
    ).toBe(true)
  })

  it("classifies and labels existing Relay mutation records", () => {
    const record = audit({
      action: "restart",
      instanceId: "server-a",
      operation: "instance.action",
    })
    expect(activityTypeForAudit(record)).toBe("power")
    expect(activityLabelForAudit(record)).toBe("Restarted a server")
  })
})
