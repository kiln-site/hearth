import { BlockList, isIP } from "node:net"

const MAX_SOURCE_CIDRS = 16

export function normalizeSourceCidrs(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value) || value.length > MAX_SOURCE_CIDRS) {
    throw new Error(
      `sourceCidrs must contain at most ${MAX_SOURCE_CIDRS} entries`
    )
  }
  return [...new Set(value.map(normalizeSourceCidr))]
}

export function exactSourceCidr(address: string): string {
  const normalized = normalizePeerAddress(address)
  const family = isIP(normalized)
  if (!family) throw new Error("Observed source address is invalid")
  return `${normalized}/${family === 4 ? 32 : 128}`
}

export function isSourceAllowed(
  address: string | undefined,
  sourceCidrs: ReadonlyArray<string>
): boolean {
  if (!sourceCidrs.length) return true
  if (!address) return false
  const peer = normalizePeerAddress(address)
  const peerFamily = isIP(peer)
  if (!peerFamily) return false

  return sourceCidrs.some((sourceCidr) => {
    const [network, prefixText] = sourceCidr.split("/")
    const family = isIP(network ?? "")
    if (!network || !prefixText || family !== peerFamily) return false
    const blockList = new BlockList()
    blockList.addSubnet(
      network,
      Number(prefixText),
      family === 4 ? "ipv4" : "ipv6"
    )
    return blockList.check(peer, family === 4 ? "ipv4" : "ipv6")
  })
}

function normalizeSourceCidr(value: unknown): string {
  if (typeof value !== "string") throw new Error("Source CIDRs must be strings")
  const trimmed = value.trim().toLowerCase()
  const separator = trimmed.lastIndexOf("/")
  const address = normalizePeerAddress(
    separator === -1 ? trimmed : trimmed.slice(0, separator)
  )
  const family = isIP(address)
  if (!family) throw new Error(`Invalid source address: ${trimmed}`)
  const maximumPrefix = family === 4 ? 32 : 128
  const prefix =
    separator === -1 ? maximumPrefix : Number(trimmed.slice(separator + 1))
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maximumPrefix) {
    throw new Error(`Invalid source CIDR prefix: ${trimmed}`)
  }

  const blockList = new BlockList()
  blockList.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6")
  return `${address}/${prefix}`
}

function normalizePeerAddress(value: string): string {
  const withoutZone = value.split("%", 1)[0] ?? value
  const mappedIpv4 = withoutZone.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)
  return mappedIpv4?.[1] ?? withoutZone
}
