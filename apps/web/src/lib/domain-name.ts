import { getDomain } from "tldts"

export function rootDomainForHostname(hostname: string): string {
  const normalized = hostname
    .trim()
    .replace(/^[.]+|[.]+$/gu, "")
    .toLowerCase()
  if (!normalized) return ""
  return getDomain(normalized, { allowPrivateDomains: true }) ?? normalized
}
