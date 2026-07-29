import { describe, expect, it } from "vite-plus/test"

import {
  domainHasActiveSrvRecord,
  managedDomainConnectAddress,
  type ManagedDomainAddress,
} from "@/lib/domain-address"

const assignment: ManagedDomainAddress = {
  domain: "kiln.site",
  publicPort: 31_337,
  srvRecordId: "cloudflare-srv-id",
  status: "active",
  supportsSrv: true,
  vanityLabel: "ember-falls",
}

describe("managed domain connect addresses", () => {
  it("omits the host port only when the SRV record is active", () => {
    expect(domainHasActiveSrvRecord(assignment)).toBe(true)
    expect(managedDomainConnectAddress(assignment)).toBe(
      "ember-falls.kiln.site"
    )

    expect(
      managedDomainConnectAddress({ ...assignment, srvRecordId: null })
    ).toBe("ember-falls.kiln.site:31337")
    expect(
      managedDomainConnectAddress({ ...assignment, status: "error" })
    ).toBe("ember-falls.kiln.site:31337")
    expect(
      managedDomainConnectAddress({ ...assignment, supportsSrv: false })
    ).toBe("ember-falls.kiln.site:31337")
  })
})
