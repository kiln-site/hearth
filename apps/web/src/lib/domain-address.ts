export interface ManagedDomainAddress {
  domain: string
  publicPort: number
  srvRecordId: string | null
  status: "active" | "error" | "pending"
  supportsSrv: boolean
  vanityLabel: string
}

export function domainHasActiveSrvRecord(
  assignment: ManagedDomainAddress
): boolean {
  return (
    assignment.supportsSrv &&
    assignment.status === "active" &&
    Boolean(assignment.srvRecordId)
  )
}

export function managedDomainConnectAddress(
  assignment: ManagedDomainAddress
): string {
  const hostname = `${assignment.vanityLabel}.${assignment.domain}`
  return domainHasActiveSrvRecord(assignment)
    ? hostname
    : hostPortAddress(hostname, assignment.publicPort)
}

export function hostPortAddress(hostname: string, port: number): string {
  const host =
    hostname.includes(":") && !hostname.startsWith("[")
      ? `[${hostname}]`
      : hostname
  return `${host}:${port}`
}
