import { describe, expect, it } from "vite-plus/test"
import type { RelayAuditRecord } from "@workspace/contracts"

import {
  activityLocalRangeToUtc,
  activityLabelForAudit,
  activityPermissionForAudit,
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
    expect(activityPermissionForAudit(record)).toBe("instance.power.restart")
  })

  it("uses the recorded permission when the audit provides one", () => {
    const record = audit(
      {
        instanceId: "instance-1",
        permission: "instance.console.write",
      },
      "browser.console.write"
    )

    expect(activityPermissionForAudit(record)).toBe("instance.console.write")
  })

  it("converts local calendar days to exact UTC query bounds", () => {
    const from = new Date(2026, 2, 7, 12)
    const to = new Date(2026, 2, 9, 12)
    const range = activityLocalRangeToUtc(from, to)
    const start = new Date(range.from)
    const end = new Date(range.to)

    expect([
      start.getFullYear(),
      start.getMonth(),
      start.getDate(),
      start.getHours(),
      start.getMinutes(),
      start.getSeconds(),
      start.getMilliseconds(),
    ]).toEqual([2026, 2, 7, 0, 0, 0, 0])
    expect([
      end.getFullYear(),
      end.getMonth(),
      end.getDate(),
      end.getHours(),
      end.getMinutes(),
      end.getSeconds(),
      end.getMilliseconds(),
    ]).toEqual([2026, 2, 9, 23, 59, 59, 999])
  })
})
