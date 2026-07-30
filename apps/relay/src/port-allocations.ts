import type {
  RelayInstancePortAllocation,
  RelayInstancePortMetadata,
} from "@workspace/contracts"
import { relayInstancePortMetadataListSchema } from "@workspace/contracts"

export const INSTANCE_PORT_ALLOCATIONS_LABEL = "kiln.instance.ports"

type PortBindings = Readonly<
  Record<
    string,
    ReadonlyArray<{ HostIp?: string; HostPort?: string }> | null | undefined
  >
>

export function portAllocationMetadataLabel(
  allocations: ReadonlyArray<RelayInstancePortAllocation>
): string {
  return JSON.stringify(
    allocations.map(
      ({ externalPort: _externalPort, ...allocation }) => allocation
    )
  )
}

export function dockerPortBindingsForAllocations(
  allocations: ReadonlyArray<RelayInstancePortAllocation>
): Record<string, Array<{ HostIp: string; HostPort: string }>> {
  return Object.fromEntries(
    allocations.map((allocation) => [
      `${allocation.internalPort}/${allocation.protocol}`,
      [
        {
          HostIp: "",
          HostPort: String(allocation.externalPort),
        },
      ],
    ])
  )
}

export function discoverPortAllocations(input: {
  bindings: PortBindings | undefined
  label: string | undefined
}): Array<RelayInstancePortAllocation> {
  const metadata = parsePortMetadata(input.label)
  if (metadata.length === 0) return []
  const discovered = discoverBindings(input.bindings)
  const metadataByBinding = new Map(
    metadata.map((allocation) => [
      `${allocation.internalPort}/${allocation.protocol}`,
      allocation,
    ])
  )

  const allocations = discovered.flatMap(
    (binding): Array<RelayInstancePortAllocation> => {
      const key = `${binding.internalPort}/${binding.protocol}`
      const configured = metadataByBinding.get(key)
      return configured
        ? [{ ...configured, externalPort: binding.externalPort }]
        : []
    }
  )

  return allocations.sort((left, right) => {
    if (left.kind === "primary") return -1
    if (right.kind === "primary") return 1
    const leftIndex = metadata.findIndex((item) => item.id === left.id)
    const rightIndex = metadata.findIndex((item) => item.id === right.id)
    if (leftIndex >= 0 || rightIndex >= 0) {
      if (leftIndex < 0) return 1
      if (rightIndex < 0) return -1
      return leftIndex - rightIndex
    }
    return left.externalPort - right.externalPort
  })
}

function parsePortMetadata(
  label: string | undefined
): Array<RelayInstancePortMetadata> {
  if (!label) return []
  try {
    const value: unknown = JSON.parse(label)
    const parsed = relayInstancePortMetadataListSchema.safeParse(value)
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

function discoverBindings(bindings: PortBindings | undefined): Array<{
  externalPort: number
  internalPort: number
  protocol: "tcp" | "udp"
}> {
  const discovered: Array<{
    externalPort: number
    internalPort: number
    protocol: "tcp" | "udp"
  }> = []
  for (const [binding, candidates] of Object.entries(bindings ?? {})) {
    const match = binding.match(/^(\d{1,5})\/(tcp|udp)$/u)
    if (!match) continue
    const internalPort = Number(match[1])
    if (
      !Number.isInteger(internalPort) ||
      internalPort < 1 ||
      internalPort > 65_535
    ) {
      continue
    }
    const externalPort = candidates
      ?.map((candidate) => Number(candidate.HostPort))
      .find(
        (candidate) =>
          Number.isInteger(candidate) && candidate >= 1 && candidate <= 65_535
      )
    if (!externalPort) continue
    discovered.push({
      externalPort,
      internalPort,
      protocol: match[2] === "udp" ? "udp" : "tcp",
    })
  }
  return discovered
}
