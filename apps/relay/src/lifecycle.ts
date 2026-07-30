import { createHash, randomBytes } from "node:crypto"
import {
  access,
  chmod,
  chown,
  mkdir,
  readdir,
  readFile,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises"
import { totalmem } from "node:os"
import { join } from "node:path"

import { resolveBrick } from "./bricks.js"
import { command } from "./command.js"
import { directoryApparentSize } from "./disk-usage.js"
import type {
  RelayCreateInstance,
  RelayInstance,
  RelayInstancePendingPrimaryPort,
  RelayInstancePortAllocation,
  RelayInstancePortInput,
  RelayInstancePortLease,
  RelayInstancePortLeaseRequest,
  RelayInstanceTailscale,
  RelayInstanceWebRoute,
  RelayInstanceWebRouteState,
  RelayNetworking,
  RelayProxyDiagnostics,
  RelayProxySettings,
  RelayTailscaleOverview,
  RelayTailscaleSettings,
  RelayTailscaleStack,
  RelayTailscaleStackApply,
  RelayTailscaleStackConfig,
  RelayTailscaleStackDns,
  RelayUpdateInstanceStartup,
} from "@workspace/contracts"
import {
  builtinTailscaleBrickId,
  builtinTailscaleBrickSource,
  relayDiskAllocationAvailableBytes,
  relayProxySettingsSchema,
  relayTailscaleOverviewSchema,
  relayTailscaleSettingsSchema,
  relayTailscaleStackConfigSchema,
  relayTailscaleStackDnsSchema,
  relayTailscaleStackSchema,
} from "@workspace/contracts"
import type { BrickCatalog } from "./bricks.js"
import type { RelayConfig, RelayInstanceConfig } from "./config.js"
import type { DockerDriver } from "./docker.js"
import {
  dockerPortBindingsForAllocations,
  portAllocationContainerLabels,
  portLabelsRequireRestart,
  portProtocols,
} from "./port-allocations.js"
import { INSTANCE_STOP_TIMEOUT_SECONDS } from "./power-state.js"
import {
  relayOwnerLabel,
  relayOwnsLabels,
  relayResourceNames,
  type RelayResourceNames,
} from "./relay-resources.js"
import type { RelayStoredWebRoute } from "./effect/state.js"
import {
  WEB_ROUTE_LABEL_PREFIX,
  WEB_ROUTE_REVISION_LABEL,
  webRouteRecoveryLabels,
} from "./web-route-labels.js"

const OWNED_LABEL = "kiln.relay.owned=true"
const TAILSCALE_IMAGE = "tailscale/tailscale:stable"
const COREDNS_IMAGE = "coredns/coredns:1.14.2"
const TAILSCALE_STACK_DISK_BYTES = 128 * 1024 * 1024
const TAILSCALE_STACK_MEMORY_BYTES = 64 * 1024 * 1024
const TAILSCALE_STACK_FORWARD_CHAIN = "KILN-TAILSCALE"
const TAILSCALE_STACK_SUBNET_COUNT = 64 * 256
const PORT_LEASE_TTL_MS = 2 * 60_000

interface PortLeaseRecord {
  expiresAt: number
  externalPort: number
  id: string
  instanceId: string
  protocol: RelayInstancePortAllocation["protocol"]
}

export function nextManagedGamePort(input: {
  end: number
  instanceId: string
  start: number
  unavailable: ReadonlySet<number>
}): number {
  const size = input.end - input.start + 1
  const preferred =
    createHash("sha256").update(input.instanceId).digest().readUInt32BE(0) %
    size
  for (let offset = 0; offset < size; offset += 1) {
    const port = input.start + ((preferred + offset) % size)
    if (!input.unavailable.has(port)) return port
  }
  throw new Error(`No game ports are available in ${input.start}-${input.end}`)
}

export function tailscaleStackFirewallRules(
  bindings: ReadonlyArray<
    Pick<RelayTailscaleStackConfig["bindings"][number], "address">
  >
): Array<Array<string>> {
  return [
    ...bindings.map(({ address }) => [
      "-A",
      TAILSCALE_STACK_FORWARD_CHAIN,
      "-d",
      `${address}/32`,
      "-j",
      // Continue through Tailscale's own forwarding chain so it can mark the
      // packet for masquerading. ACCEPT here would bypass that return path.
      "RETURN",
    ]),
    ["-A", TAILSCALE_STACK_FORWARD_CHAIN, "-j", "DROP"],
  ]
}

export function tailscaleStackFirewallIsCurrent(
  hookExists: boolean,
  specification: string,
  bindings: ReadonlyArray<
    Pick<RelayTailscaleStackConfig["bindings"][number], "address">
  >
): boolean {
  if (!hookExists) return false
  const current = specification
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`-A ${TAILSCALE_STACK_FORWARD_CHAIN} `))
  const expected = tailscaleStackFirewallRules(bindings).map((rule) =>
    rule.join(" ")
  )
  return (
    current.length === expected.length &&
    current.every((line, index) => line === expected[index])
  )
}

export function tailscaleStackPendingRemoval(
  config: RelayTailscaleStackConfig,
  snapshot: RelayTailscaleStack
): RelayTailscaleStack {
  return relayTailscaleStackSchema.parse({
    ...snapshot,
    ...config,
    components: {
      coreDnsRunning: false,
      tailscaleRunning: false,
    },
    instance: {
      ...snapshot.instance,
      containerId: null,
      observedState: "stopped",
      resources: null,
      startedAt: null,
      status: "Removal pending",
    },
    status: {
      connected: false,
      ipv4Address: null,
      ipv6Address: null,
      message: "Removal pending",
    },
  })
}

function dockerMemoryBytes(value: string): number {
  const match = value.match(/^(\d+)([bkmgt])$/iu)
  if (!match?.[1] || !match[2]) {
    throw new Error(`Invalid Docker memory limit ${value}`)
  }
  const amount = Number(match[1])
  const exponent =
    match[2].toLowerCase() === "b"
      ? 0
      : match[2].toLowerCase() === "k"
        ? 1
        : match[2].toLowerCase() === "m"
          ? 2
          : match[2].toLowerCase() === "g"
            ? 3
            : 4
  const bytes = amount * 1024 ** exponent
  if (!Number.isSafeInteger(bytes)) {
    throw new Error(`Docker memory limit ${value} is too large`)
  }
  return bytes
}

function formatAllocationBytes(bytes: number): string {
  const gibibytes = bytes / 1024 ** 3
  return `${gibibytes.toFixed(gibibytes >= 10 ? 0 : 1)} GiB`
}

export interface BackendRoute {
  hostname: string
  implementation: string
  name: string
  target: string
  version: string
}

export class LifecycleDriver {
  readonly #bricks: BrickCatalog
  readonly #config: RelayConfig
  readonly #docker: DockerDriver
  readonly #resources: RelayResourceNames
  #edgeMutation: Promise<void> = Promise.resolve()
  #edgeReconciliationPending = false
  #edgeReconciliationTimer: NodeJS.Timeout | null = null
  #hostDataDirectoryPromise: Promise<string> | null = null
  #listenerMode: RelayProxySettings["mode"] | null = null
  #gamePortMutation: Promise<void> = Promise.resolve()
  readonly #pendingGamePorts = new Set<string>()
  readonly #portLeases = new Map<string, PortLeaseRecord>()
  readonly #portLeaseTimers = new Map<string, NodeJS.Timeout>()
  readonly #tailscaleConfigs = new Map<string, RelayTailscaleStackConfig>()
  #tailscaleConfigsDiscovered = false
  readonly #tailscaleFirewallGenerations = new Map<string, string>()
  #webRoutes: ReadonlyArray<RelayStoredWebRoute> = []

  constructor(config: RelayConfig, docker: DockerDriver, bricks: BrickCatalog) {
    this.#bricks = bricks
    this.#config = config
    this.#docker = docker
    this.#resources = relayResourceNames(config)
  }

  async networking(): Promise<RelayNetworking | null> {
    try {
      return JSON.parse(
        await readFile(
          join(this.#config.dataDirectory, "networking.json"),
          "utf8"
        )
      ) as RelayNetworking
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      throw error
    }
  }

  async configureNetworking(input: RelayNetworking): Promise<RelayNetworking> {
    await mkdir(this.#config.dataDirectory, { recursive: true })
    await writeFile(
      join(this.#config.dataDirectory, "networking.json"),
      `${JSON.stringify(input, null, 2)}\n`,
      { mode: 0o600 }
    )
    if (input.enabled) await this.#ensureInfrastructure(input)
    else await this.#removeInfrastructure()
    await this.#refreshVelocityConfigurations(input)
    return input
  }

  async tailscaleSettings(): Promise<RelayTailscaleSettings | null> {
    try {
      return relayTailscaleSettingsSchema.parse(
        JSON.parse(
          await readFile(
            join(this.#config.dataDirectory, "tailscale.json"),
            "utf8"
          )
        )
      )
    } catch (cause) {
      if (hasErrorCode(cause, "ENOENT")) return null
      throw cause
    }
  }

  async tailscaleOverview(): Promise<RelayTailscaleOverview> {
    const settings = await this.tailscaleSettings()
    const installed = await this.#containerExists(
      this.#resources.tailscaleContainer
    )
    if (!installed) {
      return relayTailscaleOverviewSchema.parse({
        settings,
        status: {
          connected: false,
          coreDnsRunning: false,
          dnsAddress: null,
          installed: false,
          ipv4Address: null,
          ipv6Address: null,
          message: settings
            ? "Ready to install on this node"
            : "Configure Tailscale before installing",
          state: "not-installed",
        },
      })
    }

    const running = await this.#containerRunning(
      this.#resources.tailscaleContainer
    )
    const coreDnsRunning = await this.#containerRunning(
      this.#resources.coreDnsContainer
    )
    if (!running) {
      return relayTailscaleOverviewSchema.parse({
        settings,
        status: {
          connected: false,
          coreDnsRunning,
          dnsAddress: null,
          installed: true,
          ipv4Address: null,
          ipv6Address: null,
          message: "The Tailscale service is stopped",
          state: "stopped",
        },
      })
    }

    const [ipv4Result, ipv6Result] = await Promise.allSettled([
      command(
        "docker",
        ["exec", this.#resources.tailscaleContainer, "tailscale", "ip", "-4"],
        { timeout: 10_000 }
      ),
      command(
        "docker",
        ["exec", this.#resources.tailscaleContainer, "tailscale", "ip", "-6"],
        { timeout: 10_000 }
      ),
    ])
    const ipv4Address =
      ipv4Result.status === "fulfilled"
        ? ipv4Result.value.stdout.trim().split("\n")[0] || null
        : null
    const ipv6Address =
      ipv6Result.status === "fulfilled"
        ? ipv6Result.value.stdout.trim().split("\n")[0] || null
        : null
    const connected = Boolean(ipv4Address || ipv6Address)

    return relayTailscaleOverviewSchema.parse({
      settings,
      status: {
        connected,
        coreDnsRunning,
        dnsAddress: ipv4Address ?? ipv6Address,
        installed: true,
        ipv4Address,
        ipv6Address,
        message: connected
          ? null
          : "Tailscale is starting or waiting for authentication",
        state: connected ? "connected" : "connecting",
      },
    })
  }

  async configureTailscale(
    input: RelayTailscaleSettings
  ): Promise<RelayTailscaleOverview> {
    const settings = relayTailscaleSettingsSchema.parse(input)
    const previous = await this.tailscaleSettings()
    if (
      previous &&
      (previous.domain !== settings.domain ||
        previous.proxyPort !== settings.proxyPort)
    ) {
      const connectedInstances = (await this.#docker.inspectInstances()).filter(
        (instance) => instance.managedByRelay && instance.tailscale.enabled
      )
      if (connectedInstances.length > 0) {
        throw new Error(
          "Disconnect Tailscale-enabled servers before changing the global domain or proxy port"
        )
      }
    }
    await mkdir(this.#config.dataDirectory, { recursive: true })
    await writeFile(
      join(this.#config.dataDirectory, "tailscale.json"),
      `${JSON.stringify(settings, null, 2)}\n`,
      { mode: 0o600 }
    )

    const overview = await this.tailscaleOverview()
    if (overview.status.connected) {
      await command(
        "docker",
        [
          "exec",
          this.#resources.tailscaleContainer,
          "tailscale",
          "set",
          `--hostname=${settings.hostname}`,
        ],
        { timeout: 30_000 }
      )
      await this.#ensureTailscaleDns(settings, overview.status.dnsAddress, true)
    }
    return this.tailscaleOverview()
  }

  async installTailscale(authKey: string): Promise<RelayTailscaleOverview> {
    const settings = await this.tailscaleSettings()
    if (!settings) throw new Error("Configure Tailscale before installing")

    const infrastructure = join(this.#config.dataDirectory, "infrastructure")
    const hostInfrastructure = join(
      await this.#hostDataDirectory(),
      "infrastructure"
    )
    await mkdir(join(infrastructure, "tailscale", "state"), {
      recursive: true,
      mode: 0o700,
    })

    try {
      await this.#replaceContainer(
        this.#resources.tailscaleContainer,
        this.#tailscaleContainerArguments(settings, hostInfrastructure, true),
        { ...process.env, TS_AUTHKEY: authKey }
      )
      const connected = await this.#waitForTailscaleConnection(90_000)
      if (!connected.status.connected || !connected.status.dnsAddress) {
        throw new Error(
          connected.status.message ?? "Tailscale did not connect in time"
        )
      }

      // Once the persisted node identity is authenticated, recreate without
      // the one-time key so it is not retained in Docker container metadata.
      await this.#replaceContainer(
        this.#resources.tailscaleContainer,
        this.#tailscaleContainerArguments(settings, hostInfrastructure)
      )
      const reconnected = await this.#waitForTailscaleConnection(45_000)
      if (!reconnected.status.connected || !reconnected.status.dnsAddress) {
        throw new Error("Tailscale did not reconnect with its persisted state")
      }
      await this.#ensureTailscaleDns(
        settings,
        reconnected.status.dnsAddress,
        true
      )
      return this.tailscaleOverview()
    } catch (cause) {
      await this.#removeOwnedContainer(
        this.#resources.tailscaleContainer
      ).catch(() => undefined)
      const message =
        cause instanceof Error
          ? cause.message.replaceAll(authKey, "[REDACTED]")
          : "unknown error"
      throw new Error(`Could not install Tailscale: ${message}`)
    }
  }

  async tailscaleStacks(): Promise<Array<RelayTailscaleStack>> {
    const entries = await readdir(this.#config.rootDirectory, {
      encoding: "utf8",
      withFileTypes: true,
    }).catch((cause: unknown) => {
      if (hasErrorCode(cause, "ENOENT")) return []
      throw cause
    })
    const stacks = await Promise.all(
      entries
        .filter(
          (entry) => entry.isDirectory() && /^[a-f0-9]{40}$/u.test(entry.name)
        )
        .map(async (entry) => {
          const config = await this.#readTailscaleStackConfig(entry.name)
          return config ? this.#tailscaleStack(config) : null
        })
    )
    return stacks
      .filter((stack): stack is RelayTailscaleStack => stack !== null)
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  async reconcileTailscaleStackFirewalls(): Promise<void> {
    const configs = await this.#knownTailscaleStackConfigs()
    const stackIds = new Set(configs.map(({ id }) => id))
    for (const id of this.#tailscaleFirewallGenerations.keys()) {
      if (!stackIds.has(id)) this.#tailscaleFirewallGenerations.delete(id)
    }
    const results = await Promise.allSettled(
      configs.map(async (config) => {
        if (await this.#tailscaleStackRemovalPending(config.id)) return
        const generation = await this.#tailscaleStackContainerGeneration(
          config.id
        )
        if (!generation) {
          this.#tailscaleFirewallGenerations.delete(config.id)
          return
        }
        if (this.#tailscaleFirewallGenerations.get(config.id) === generation) {
          return
        }
        await this.#ensureTailscaleStackFirewall(config)
        this.#tailscaleFirewallGenerations.set(config.id, generation)
      })
    )
    const failures = results.flatMap((result, index) =>
      result.status === "rejected"
        ? [
            `${configs[index]?.name ?? "Unknown stack"}: ${
              result.reason instanceof Error
                ? result.reason.message
                : "unknown error"
            }`,
          ]
        : []
    )
    if (failures.length > 0) {
      throw new Error(
        `Could not restore Tailscale forwarding rules: ${failures.join("; ")}`
      )
    }
  }

  async applyTailscaleStack(
    rawInput: RelayTailscaleStackApply
  ): Promise<RelayTailscaleStack> {
    const input = rawInput
    await this.#assertTailscaleStackRemovalNotPending(
      input.id,
      "apply changes to"
    )
    const existing = await this.#readTailscaleStackConfig(input.id)
    const instances = await this.#docker.inspectInstances()
    for (const binding of input.bindings) {
      const instance = instances.find(
        (candidate) => candidate.id === binding.instanceId
      )
      if (!instance || !instance.managedByRelay) {
        throw new Error(
          `Server ${binding.instanceId.slice(0, 8)} was not found`
        )
      }
      if (instance.brickId === builtinTailscaleBrickId) {
        throw new Error("A Tailscale deployment cannot attach to itself")
      }
    }

    const duplicateHostname = input.bindings.find(
      (binding, index, bindings) =>
        bindings.findIndex(
          (candidate) => candidate.hostname === binding.hostname
        ) !== index
    )
    if (duplicateHostname) {
      throw new Error(
        `Hostname ${duplicateHostname.hostname}.${input.domain} is selected more than once`
      )
    }

    const reservedSubnets = new Set(
      (await this.#tailscaleStackConfigs())
        .filter((config) => config.id !== input.id)
        .map((config) => config.subnet)
    )
    const subnet =
      existing?.subnet ??
      allocateTailscaleStackSubnet(
        input.id,
        this.#config.nodeId,
        reservedSubnets
      )
    const bindings = assignTailscaleBindingAddresses(
      subnet,
      existing?.bindings ?? [],
      input.bindings
    )
    const config = relayTailscaleStackConfigSchema.parse({
      bindings,
      domain: input.domain,
      hostname: input.hostname,
      id: input.id,
      name: input.name,
      subnet,
    })

    const containerName = this.#resources.tailscaleStackContainer(input.id)
    const containerExists = await this.#containerExists(containerName)
    if (!containerExists && !input.authKey) {
      throw new Error(
        "An auth key is required to install Tailscale on this node"
      )
    }
    const previousDnsRecords = existing
      ? await this.#readTailscaleStackDnsRecords(existing)
      : []

    try {
      await this.#ensureTailscaleStackNetwork(config)
      await this.#writeTailscaleStackConfig(config)
      if (!containerExists) {
        await this.#installTailscaleStack(config, input.authKey!)
      } else if (
        existing &&
        (existing.domain !== config.domain ||
          existing.hostname !== config.hostname ||
          existing.name !== config.name)
      ) {
        await this.#restartTailscaleStack(config)
      }
      // Docker can attach and detach a running game container from this
      // private bridge without recreating or restarting it.
      await this.#reconcileTailscaleStackBindings(
        config.id,
        existing?.bindings ?? [],
        config.bindings
      )
      await this.#configureTailscaleStackRouting(config)
      await this.#ensureTailscaleStackDns(
        config,
        config.bindings.map(({ address, hostname }) => ({ address, hostname }))
      )
      return this.#tailscaleStack(config)
    } catch (cause) {
      let rollbackMessage = ""
      try {
        await this.#rollbackTailscaleStackApply(
          config,
          existing,
          previousDnsRecords
        )
      } catch (rollbackCause) {
        rollbackMessage = ` Rollback also failed: ${
          rollbackCause instanceof Error
            ? rollbackCause.message
            : "unknown error"
        }.`
      }
      const message =
        cause instanceof Error
          ? input.authKey
            ? cause.message.replaceAll(input.authKey, "[REDACTED]")
            : cause.message
          : "unknown error"
      throw new Error(
        `Could not apply Tailscale stack: ${message}.${rollbackMessage}`
      )
    }
  }

  async syncTailscaleStackDns(
    input: RelayTailscaleStackDns
  ): Promise<RelayTailscaleStack> {
    await this.#assertTailscaleStackRemovalNotPending(
      input.id,
      "synchronize DNS for"
    )
    const config = await this.#readTailscaleStackConfig(input.id)
    if (!config) throw new Error("Tailscale stack not found")
    const duplicateHostname = input.records.find(
      (record, index, records) =>
        records.findIndex(
          (candidate) => candidate.hostname === record.hostname
        ) !== index
    )
    if (duplicateHostname) {
      throw new Error(
        `Duplicate private hostname ${duplicateHostname.hostname}`
      )
    }
    await this.#ensureTailscaleStackDns(config, input.records)
    return this.#tailscaleStack(config)
  }

  async removeTailscaleStack(
    id: string,
    mode: "commit" | "prepare" | "rollback" = "commit",
    controlPlaneDeviceRemoved = false
  ): Promise<void> {
    if (mode === "prepare") {
      await this.#prepareTailscaleStackRemoval(id)
      return
    }
    if (mode === "rollback") {
      await this.#rollbackTailscaleStackRemoval(id)
      return
    }

    await this.#prepareTailscaleStackRemoval(id)
    await this.#commitTailscaleStackRemoval(id, controlPlaneDeviceRemoved)
  }

  async #prepareTailscaleStackRemoval(id: string): Promise<void> {
    const config = await this.#readTailscaleStackConfig(id)
    if (!config) return
    const alreadyPending = await this.#tailscaleStackRemovalPending(id)
    if (!alreadyPending) {
      const snapshot = await this.#tailscaleStack(config)
      await writeFile(
        this.#tailscaleStackRemovalSnapshot(id),
        `${JSON.stringify(snapshot, null, 2)}\n`,
        { mode: 0o600 }
      )
      const marker = this.#tailscaleStackRemovalMarker(id)
      await writeFile(marker, "prepared\n", { mode: 0o600 })
    }
    const network = this.#resources.tailscaleStackNetwork(id)
    try {
      for (const binding of config.bindings) {
        const instance = await this.#docker.findInstance(binding.instanceId)
        if (instance) {
          await command("docker", [
            "network",
            "disconnect",
            "--force",
            network,
            instance.service,
          ]).catch(() => undefined)
        }
      }
      await this.#removeOwnedContainer(
        this.#resources.tailscaleStackDnsContainer(id)
      )
      const container = this.#resources.tailscaleStackContainer(id)
      if (await this.#containerExists(container)) {
        await command("docker", ["stop", "--time", "10", container], {
          timeout: 30_000,
        })
      }
    } catch (cause) {
      if (!alreadyPending) {
        await this.#rollbackTailscaleStackRemoval(id).catch(() => undefined)
      }
      throw cause
    }
  }

  async #rollbackTailscaleStackRemoval(id: string): Promise<void> {
    if (!(await this.#tailscaleStackRemovalPending(id))) return
    const config = await this.#readTailscaleStackConfig(id)
    if (!config) return
    await this.#ensureTailscaleStackNetwork(config)
    await this.#restartTailscaleStack(config)
    await this.#reconcileTailscaleStackBindings(id, [], config.bindings)
    await this.#configureTailscaleStackRouting(config)
    await this.#ensureTailscaleStackDns(
      config,
      config.bindings.map(({ address, hostname }) => ({ address, hostname }))
    )
    await rm(this.#tailscaleStackRemovalMarker(id), { force: true })
    await rm(this.#tailscaleStackRemovalSnapshot(id), { force: true })
  }

  async #commitTailscaleStackRemoval(
    id: string,
    controlPlaneDeviceRemoved = false
  ): Promise<void> {
    const config = await this.#readTailscaleStackConfig(id)
    if (!config) return
    const network = this.#resources.tailscaleStackNetwork(id)
    const container = this.#resources.tailscaleStackContainer(id)
    if (
      !controlPlaneDeviceRemoved &&
      !(await this.#containerExists(container)) &&
      (await this.#tailscaleStackIdentityExists(id))
    ) {
      await this.#ensureTailscaleStackNetwork(config)
      await this.#replaceContainer(
        container,
        await this.#tailscaleStackContainerArguments(config, false)
      )
    }
    if (
      !controlPlaneDeviceRemoved &&
      (await this.#containerExists(container))
    ) {
      await command("docker", ["start", container], {
        timeout: 30_000,
      })
      try {
        await this.#logoutTailscaleStack(container)
      } catch (cause) {
        await command("docker", ["stop", "--time", "10", container], {
          timeout: 30_000,
        }).catch(() => undefined)
        throw new Error(
          `Could not log the Tailscale machine out; local identity was preserved for retry: ${
            cause instanceof Error ? cause.message : "unknown error"
          }`,
          { cause }
        )
      }
    }
    await this.#removeOwnedContainer(
      this.#resources.tailscaleStackDnsContainer(id)
    )
    await this.#removeOwnedContainer(container)
    await this.#removeOwnedNetwork(network)
    await rm(
      join(
        this.#config.dataDirectory,
        "infrastructure",
        "tailscale-stacks",
        id
      ),
      { force: true, recursive: true }
    )
    await rm(join(this.#config.rootDirectory, id), {
      force: true,
      recursive: true,
    })
    this.#tailscaleConfigs.delete(id)
  }

  async #logoutTailscaleStack(container: string): Promise<void> {
    let lastCause: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await command("docker", ["exec", container, "tailscale", "logout"], {
          timeout: 30_000,
        })
        return
      } catch (cause) {
        lastCause = cause
        if (attempt < 2) {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
        }
      }
    }
    throw lastCause
  }

  #tailscaleStackRemovalMarker(id: string): string {
    return join(this.#config.rootDirectory, id, ".removing")
  }

  #tailscaleStackRemovalSnapshot(id: string): string {
    return join(this.#config.rootDirectory, id, ".removing-stack.json")
  }

  async #tailscaleStackRemovalPending(id: string): Promise<boolean> {
    try {
      await readFile(this.#tailscaleStackRemovalMarker(id))
      return true
    } catch (cause) {
      if (hasErrorCode(cause, "ENOENT")) return false
      throw cause
    }
  }

  async #assertTailscaleStackRemovalNotPending(
    id: string,
    operation: string
  ): Promise<void> {
    if (!(await this.#tailscaleStackRemovalPending(id))) return
    throw new Error(
      `Cannot ${operation} this Tailscale deployment while removal cleanup is pending. Retry removing the node from Infrastructure → Tailscale first.`
    )
  }

  async #readTailscaleStackRemovalSnapshot(
    id: string
  ): Promise<RelayTailscaleStack | null> {
    try {
      return relayTailscaleStackSchema.parse(
        JSON.parse(
          await readFile(this.#tailscaleStackRemovalSnapshot(id), "utf8")
        )
      )
    } catch (cause) {
      if (hasErrorCode(cause, "ENOENT")) return null
      throw cause
    }
  }

  async proxySettings(): Promise<RelayProxySettings> {
    try {
      return relayProxySettingsSchema.parse(
        JSON.parse(
          await readFile(join(this.#config.dataDirectory, "proxy.json"), "utf8")
        )
      )
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause
      const seeded = relayProxySettingsSchema.parse({
        acmeEmail: this.#config.traefikAcmeEmail,
        mode: this.#config.proxyMode,
        traefikImage: this.#config.traefikImage,
      })
      await this.#writeProxySettings(seeded)
      return seeded
    }
  }

  async configureProxy(
    input: RelayProxySettings,
    routes: ReadonlyArray<RelayStoredWebRoute>
  ): Promise<{
    diagnostics: RelayProxyDiagnostics
    settings: RelayProxySettings
  }> {
    const settings = relayProxySettingsSchema.parse(input)
    if (
      this.#listenerMode &&
      usesProxyTlsTermination(this.#listenerMode) !==
        usesProxyTlsTermination(settings.mode)
    ) {
      throw new Error(
        "Switching proxy TLS termination on or off changes Relay's private listener protocol. Set KILN_RELAY_PROXY, remove /data/proxy.json once, and restart Relay."
      )
    }
    await this.#writeProxySettings(settings)
    this.hydrateProxySettings(settings)
    await this.configureWebRoutes(routes, settings)
    if (settings.mode === "traefik") {
      const diagnostics = await this.proxyDiagnostics(settings)
      if (diagnostics.status !== "blocked") {
        await this.#ensureTraefik(settings, routes, true)
      }
    } else {
      await this.#removeBundledTraefik()
    }
    this.#scheduleEdgeReconciliation(settings)
    return { diagnostics: await this.proxyDiagnostics(settings), settings }
  }

  async initializeProxy(
    routes: ReadonlyArray<RelayStoredWebRoute>,
    configuredSettings?: RelayProxySettings
  ): Promise<void> {
    const settings = configuredSettings ?? (await this.proxySettings())
    this.hydrateProxySettings(settings)
    this.#listenerMode = settings.mode
    await this.configureWebRoutes(routes, settings)
    if (settings.mode === "traefik") {
      const diagnostics = await this.proxyDiagnostics(settings)
      if (diagnostics.status !== "blocked") {
        await this.#ensureTraefik(settings, routes, false)
      } else {
        console.error(
          "Bundled Traefik is configured but could not start:",
          diagnostics.warnings.join(" ")
        )
      }
    } else {
      await this.#removeBundledTraefik()
    }
    this.#scheduleEdgeReconciliation(settings)
  }

  close(): void {
    if (this.#edgeReconciliationTimer) {
      clearInterval(this.#edgeReconciliationTimer)
      this.#edgeReconciliationTimer = null
    }
  }

  async assertPrivateProxyListener(): Promise<void> {
    if (!usesProxyTlsTermination(this.#config.proxyMode)) return
    const reference = process.env.HOSTNAME?.trim()
    if (!reference) {
      throw new Error(
        "Proxy TLS mode could not identify the Relay container to verify that private HTTP port 4100 is not published."
      )
    }
    const inspected = await command("docker", [
      "inspect",
      "--format",
      "{{json .HostConfig.PortBindings}}",
      reference,
    ]).catch((cause: unknown) => {
      throw new Error(
        "Proxy TLS mode could not inspect its Relay container through the Docker socket. Keep the socket mounted so Relay can verify its private listener.",
        { cause }
      )
    })
    const bindings = JSON.parse(inspected.stdout) as Record<
      string,
      Array<{ HostIp?: string; HostPort?: string }> | null
    > | null
    const published = bindings?.[`${this.#config.port}/tcp`] ?? []
    const unsafe = published.filter(
      (binding) => binding.HostIp !== "127.0.0.1" && binding.HostIp !== "::1"
    )
    if (unsafe.length > 0) {
      throw new Error(
        `Proxy TLS mode refuses to start because Relay's private HTTP port ${this.#config.port} is published on the host. Remove the host port mapping and expose the port only to the private Traefik network.`
      )
    }
  }

  hydrateProxySettings(settings: RelayProxySettings): void {
    this.#config.proxyMode = settings.mode
    this.#config.traefikImage = settings.traefikImage
    this.#config.traefikAcmeEmail = settings.acmeEmail
    if (settings.mode === "traefik") {
      this.#config.publicPort = 443
      this.#config.browserOrigin = `https://${formatPublicHost(this.#config.advertisedHost)}`
    } else if (settings.mode === "coolify") {
      this.#config.publicPort = this.#config.coolifyPublicOrigin
        ? effectiveUrlPort(new URL(this.#config.coolifyPublicOrigin))
        : 443
      this.#config.browserOrigin =
        this.#config.coolifyPublicOrigin ??
        `https://${formatPublicHost(this.#config.advertisedHost)}`
    } else {
      this.#config.publicPort = this.#config.directPublicPort
      this.#config.browserOrigin = this.#config.directBrowserOrigin
    }
  }

  async proxyDiagnostics(
    configuredSettings?: RelayProxySettings
  ): Promise<RelayProxyDiagnostics> {
    const settings = configuredSettings ?? (await this.proxySettings())
    const ports = await Promise.all(
      ([80, 443] as const).map(async (port) => {
        const result = await command("docker", [
          "ps",
          "--filter",
          `publish=${port}`,
          "--format",
          "{{.Names}}",
        ])
        const owners = result.stdout
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean)
        const conflictingOwner = owners.find(
          (owner) => owner !== this.#resources.traefikContainer
        )
        return {
          available: !conflictingOwner,
          owner: conflictingOwner ?? owners[0] ?? null,
          port,
        }
      })
    )
    const bundledContainerRunning = await command("docker", [
      "inspect",
      "--format",
      "{{.State.Running}}",
      this.#resources.traefikContainer,
    ])
      .then((result) => result.stdout.trim() === "true")
      .catch(() => false)
    const coolifyProxy =
      settings.mode === "coolify"
        ? await this.#externalTraefikContainer(settings)
        : null
    const containerRunning =
      settings.mode === "coolify"
        ? Boolean(coolifyProxy)
        : bundledContainerRunning
    const conflicts = ports.filter((port) => !port.available)
    const warnings: Array<string> = []
    if (settings.mode === "traefik" && conflicts.length > 0) {
      warnings.push(
        conflicts
          .map(
            (port) =>
              `Port ${port.port} is already used by ${port.owner ?? "another process"}.`
          )
          .join(" ")
      )
    }
    if (settings.mode === "traefik") {
      warnings.push(
        "Public reachability and DNS cannot be proven from inside the Relay. Hearth and the browser must complete the external probe."
      )
    }
    if (settings.mode === "hearth") {
      warnings.push(
        "Hearth proxy mode covers Kiln console and file traffic; public Ember websites require an external or bundled Traefik edge."
      )
    }
    if (settings.mode === "none") {
      warnings.push(
        `Manual edge mode does not modify an external proxy. Attach it to ${this.#resources.edgeNetwork} before publishing Ember routes.`
      )
    }
    let coolifyReady = false
    if (settings.mode === "coolify") {
      if (!coolifyProxy) {
        warnings.push(
          "Coolify mode could not find a running coolify-proxy container. Confirm this Relay is on a Coolify host using its Traefik proxy."
        )
      } else if (
        !(await containerUsesNetwork(coolifyProxy, this.#resources.edgeNetwork))
      ) {
        warnings.push(
          `Coolify Traefik is not attached to ${this.#resources.edgeNetwork}. Relay will keep retrying the private edge attachment.`
        )
      } else {
        coolifyReady = true
      }
    }
    return {
      browserOrigin: this.#config.browserOrigin,
      containerRunning,
      mode: settings.mode,
      ports,
      publicReachability: "unknown",
      status:
        settings.mode === "none"
          ? "disabled"
          : settings.mode === "hearth"
            ? "hearth"
            : settings.mode === "coolify"
              ? coolifyReady
                ? "ready"
                : "blocked"
              : conflicts.length > 0
                ? "blocked"
                : containerRunning
                  ? "ready"
                  : "starting",
      warnings,
    }
  }

  async configureWebRoutes(
    routes: ReadonlyArray<RelayStoredWebRoute>,
    configuredSettings?: RelayProxySettings
  ): Promise<void> {
    const settings = configuredSettings ?? (await this.proxySettings())
    this.#webRoutes = routes
    const directory = join(
      this.#config.dataDirectory,
      "infrastructure",
      "traefik",
      "dynamic"
    )
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(
      join(directory, "kiln.yaml"),
      traefikDynamicConfiguration(this.#config, routes, settings),
      { mode: 0o600 }
    )
    if (settings.mode === "none" || settings.mode === "coolify") {
      await this.#serializeEdgeMutation(() =>
        this.#reconcileExternalTraefikRoutes(routes, settings)
      )
    } else {
      await this.#removeExternalTraefikRoutes()
      await this.#serializeEdgeMutation(() =>
        this.#disableExternalEdge(settings)
      )
    }
  }

  async webRouteState(
    instanceId: string,
    routes: ReadonlyArray<RelayInstanceWebRoute>
  ): Promise<RelayInstanceWebRouteState> {
    const settings = await this.proxySettings()
    if (settings.mode === "traefik") {
      return {
        edgeConnected: false,
        message:
          routes.length > 0
            ? "Bundled Traefik applies this route dynamically. Container recovery labels sync on the next Ember restart."
            : "Bundled Traefik applies route changes dynamically.",
        proxyConnected: true,
        requiresRestart: false,
        routes: [...routes],
        status: "ready",
      }
    }
    if (settings.mode === "hearth") {
      return {
        edgeConnected: false,
        message:
          "Hearth proxy mode does not publish Ember websites. Choose an existing or bundled Traefik edge.",
        proxyConnected: false,
        requiresRestart: false,
        routes: [...routes],
        status: routes.length > 0 ? "blocked" : "ready",
      }
    }

    const instance = await this.#docker.findInstance(instanceId)
    if (!instance) throw new Error("Instance not found")
    const profile = this.#externalTraefikProfile(settings)
    const desiredLabels = traefikRouteLabels(
      routes,
      profile,
      this.#resources.edgeNetwork
    )
    const labels = await containerLabels(instance.service)
    const requiresRestart = routeLabelsRequireRestart(
      labels,
      routes,
      desiredLabels
    )
    const edgeConnected = await containerUsesNetwork(
      instance.service,
      this.#resources.edgeNetwork
    )
    const proxy = await this.#externalTraefikContainer(settings)
    const proxyConnected = Boolean(
      proxy && (await containerUsesNetwork(proxy, this.#resources.edgeNetwork))
    )

    if (requiresRestart) {
      return {
        edgeConnected,
        message:
          routes.length > 0
            ? "Restart this Ember to apply its pending Traefik labels."
            : "Public access is disabled now; restart once to remove stale Traefik labels.",
        proxyConnected,
        requiresRestart: true,
        routes: [...routes],
        status: "pending_restart",
      }
    }
    if (routes.length > 0 && (!edgeConnected || !proxyConnected)) {
      return {
        edgeConnected,
        message: proxy
          ? `Relay found ${proxy}, but the ${this.#resources.edgeNetwork} attachment is not ready yet.`
          : settings.mode === "coolify"
            ? "Relay could not find Coolify's running coolify-proxy container."
            : `Attach your Traefik container to ${this.#resources.edgeNetwork} to activate this route.`,
        proxyConnected,
        requiresRestart: false,
        routes: [...routes],
        status: "blocked",
      }
    }
    return {
      edgeConnected,
      message:
        routes.length > 0
          ? "Traefik labels and edge network membership are applied."
          : "This Ember is not exposed to the edge network.",
      proxyConnected,
      requiresRestart: false,
      routes: [...routes],
      status: "ready",
    }
  }

  async runInstanceAction(
    instance: RelayInstanceConfig,
    action: "start" | "stop" | "restart" | "kill",
    routes: ReadonlyArray<RelayInstanceWebRoute>,
    pendingPrimaryPort: RelayInstancePendingPrimaryPort | null = null
  ): Promise<RelayInstance> {
    if (instance.brickId === builtinTailscaleBrickId) {
      if (action === "start" || action === "restart") {
        await this.#assertTailscaleStackRemovalNotPending(instance.id, action)
      }
      const coreDns = this.#resources.tailscaleStackDnsContainer(instance.id)
      if (action === "stop" || action === "kill") {
        await command("docker", [action, coreDns]).catch(() => undefined)
        return this.#docker.runAction(instance, action)
      }
      const updated = await this.#docker.runAction(instance, action)
      const config = await this.#readTailscaleStackConfig(instance.id)
      if (
        config &&
        !(await this.#waitForTailscaleStackConnection(instance.id, 45_000))
      ) {
        throw new Error(
          "Tailscale did not reconnect with its persisted identity"
        )
      }
      if (config) await this.#configureTailscaleStackRouting(config)
      await command("docker", [
        action === "restart" ? "restart" : "start",
        coreDns,
      ]).catch(() => undefined)
      return updated
    }
    if (action === "start" || action === "restart") {
      const usedBytes = await directoryApparentSize(
        join(this.#config.rootDirectory, instance.directory)
      )
      if (usedBytes > instance.limits.diskBytes) {
        throw new Error(
          `Cannot ${action} ${instance.name}: its ${formatAllocationBytes(usedBytes)} of files exceed the ${formatAllocationBytes(instance.limits.diskBytes)} disk quota`
        )
      }
    }
    const settings = await this.proxySettings()
    if (
      instance.managedByRelay &&
      (action === "start" || action === "restart")
    ) {
      const hasPrimary = instance.ports.some(
        (allocation) => allocation.kind === "primary"
      )
      const inspected = pendingPrimaryPort
        ? await this.#docker.inspectInstances()
        : null
      const pendingExternalPort =
        pendingPrimaryPort && !hasPrimary && inspected
          ? await this.#reserveGamePort(
              instance.id,
              pendingPrimaryPort.protocol,
              inspected
            )
          : null
      try {
        const allocations =
          pendingPrimaryPort && pendingExternalPort
            ? [
                {
                  externalPort: pendingExternalPort,
                  id: "primary" as const,
                  internalPort: pendingPrimaryPort.internalPort,
                  kind: "primary" as const,
                  name: "Default Server",
                  protocol: pendingPrimaryPort.protocol,
                },
                ...instance.ports,
              ]
            : instance.ports
        const desiredLabels = this.#containerWebRouteLabels(routes, settings)
        const labels = await containerLabels(instance.service)
        const primary = allocations.find(
          (allocation) => allocation.kind === "primary"
        )
        const desiredPortLabels = primary
          ? portAllocationContainerLabels(allocations)
          : null
        const portConfiguration =
          primary && desiredPortLabels
            ? {
                bindings: dockerPortBindingsForAllocations(allocations),
                labels: {
                  ...desiredPortLabels,
                  "kiln.traefik.service.port": String(primary.internalPort),
                },
              }
            : undefined
        if (
          pendingExternalPort ||
          routeLabelsRequireRestart(labels, routes, desiredLabels) ||
          (desiredPortLabels &&
            portLabelsRequireRestart(labels, desiredPortLabels))
        ) {
          const usesExternalEdge =
            settings.mode === "none" || settings.mode === "coolify"
          if (usesExternalEdge && routes.length > 0) {
            await this.#ensureEdgeNetwork()
          }
          const updated = await this.#docker.recreateOwnedInstance(
            instance,
            desiredLabels,
            usesExternalEdge && routes.length > 0
              ? this.#resources.edgeNetwork
              : null,
            action,
            portConfiguration
          )
          if (pendingExternalPort) {
            const networking = await this.networking()
            if (networking?.enabled) {
              await this.#refreshCoreDnsConfiguration(networking)
            }
            await this.#refreshTailscaleDns()
            if (updated.brickNetworkMode === "minecraft-backend") {
              await this.#refreshVelocityConfigurations(networking)
            }
          }
          return updated
        }
      } finally {
        if (pendingPrimaryPort && pendingExternalPort) {
          for (const protocol of portProtocols(pendingPrimaryPort.protocol)) {
            this.#pendingGamePorts.delete(`${protocol}:${pendingExternalPort}`)
          }
        }
      }
    }
    return this.#docker.runAction(instance, action)
  }

  async #writeProxySettings(settings: RelayProxySettings): Promise<void> {
    await mkdir(this.#config.dataDirectory, { recursive: true })
    await writeFile(
      join(this.#config.dataDirectory, "proxy.json"),
      `${JSON.stringify(settings, null, 2)}\n`,
      { mode: 0o600 }
    )
  }

  async updateInstancePorts(
    instanceId: string,
    requested: ReadonlyArray<RelayInstancePortInput>,
    routes: ReadonlyArray<RelayInstanceWebRoute>
  ): Promise<RelayInstance> {
    const inspected = await this.#docker.inspectInstances()
    const instance = inspected.find((candidate) => candidate.id === instanceId)
    if (!instance) throw new Error("Instance not found")
    if (!instance.managedByRelay) {
      throw new Error(
        "Relay can only configure ports for containers it created"
      )
    }
    if (instance.brickId === builtinTailscaleBrickId) {
      throw new Error(
        "Configure this Tailscale network from Infrastructure → Tailscale"
      )
    }
    const existingById = new Map(
      instance.ports.map((allocation) => [allocation.id, allocation])
    )
    const systemAllocations = instance.ports.filter(
      (allocation) => allocation.kind !== "custom"
    )
    const hasPrimary = systemAllocations.some(
      (allocation) => allocation.kind === "primary"
    )
    const primaryInput = requested.find((input) => input.id === "primary")
    if (!hasPrimary && !primaryInput) {
      throw new Error(
        "Configure the Default Server before allocating additional ports."
      )
    }
    for (const allocation of systemAllocations) {
      if (!requested.some((input) => input.id === allocation.id)) {
        throw new Error(`${allocation.name} is required by this server`)
      }
    }
    if (!hasPrimary && primaryInput && instance.desiredState === "running") {
      const unchangedExistingPorts = requested
        .filter((input) => input.id !== "primary")
        .every((input) => {
          const existing = input.id ? existingById.get(input.id) : undefined
          return (
            existing !== undefined &&
            existing.internalPort === input.internalPort &&
            existing.name === input.name &&
            existing.protocol === input.protocol
          )
        })
      if (
        requested.length !== instance.ports.length + 1 ||
        !unchangedExistingPorts
      ) {
        throw new Error(
          "Assign the Default Server separately before changing other ports."
        )
      }
      return {
        ...instance,
        pendingPrimaryPort: {
          id: "primary",
          internalPort: primaryInput.internalPort,
          name: "Default Server",
          protocol: primaryInput.protocol,
        },
      }
    }

    const pending: Array<{
      port: number
      protocol: RelayInstancePortAllocation["protocol"]
    }> = []
    const allocations: Array<RelayInstancePortAllocation> = []
    try {
      for (const input of requested) {
        const existing = input.id ? existingById.get(input.id) : undefined
        if (input.id && !existing) {
          if (input.id !== "primary" || hasPrimary) {
            throw new Error(`Port allocation ${input.id} no longer exists`)
          }
          const externalPort = await this.#claimPortLease(
            instance.id,
            input,
            inspected
          )
          pending.push({ port: externalPort, protocol: input.protocol })
          allocations.push({
            externalPort,
            id: "primary",
            internalPort: input.internalPort,
            kind: "primary",
            name: "Default Server",
            protocol: input.protocol,
          })
          continue
        }
        if (existing) {
          if (existing.protocol !== input.protocol) {
            throw new Error(
              `The ${existing.name} protocol cannot be changed after allocation`
            )
          }
          allocations.push({
            ...existing,
            internalPort: input.internalPort,
            name: input.name,
          })
          continue
        }

        const externalPort = await this.#claimPortLease(
          instance.id,
          input,
          inspected
        )
        pending.push({ port: externalPort, protocol: input.protocol })
        let id = randomBytes(4).toString("hex")
        while (
          existingById.has(id) ||
          allocations.some((allocation) => allocation.id === id)
        ) {
          id = randomBytes(4).toString("hex")
        }
        allocations.push({
          externalPort,
          id,
          internalPort: input.internalPort,
          kind: "custom",
          name: input.name,
          protocol: input.protocol,
        })
      }

      const primary = allocations.find(
        (allocation) => allocation.kind === "primary"
      )
      if (!primary) throw new Error("The primary game port is required")
      const settings = await this.proxySettings()
      const routeLabels = this.#containerWebRouteLabels(routes, settings)
      const usesExternalEdge =
        settings.mode === "none" || settings.mode === "coolify"
      if (usesExternalEdge && routes.length > 0) {
        await this.#ensureEdgeNetwork()
      }
      const updated = await this.#docker.recreateOwnedInstance(
        instance,
        routeLabels,
        usesExternalEdge && routes.length > 0
          ? this.#resources.edgeNetwork
          : null,
        instance.desiredState === "running" ? "restart" : "stop",
        {
          bindings: dockerPortBindingsForAllocations(allocations),
          labels: {
            ...portAllocationContainerLabels(allocations),
            "kiln.traefik.service.port": String(primary.internalPort),
          },
        }
      )
      const networking = await this.networking()
      if (networking?.enabled) {
        await this.#refreshCoreDnsConfiguration(networking)
      }
      await this.#refreshTailscaleDns()
      if (updated.brickNetworkMode === "minecraft-backend") {
        await this.#refreshVelocityConfigurations(networking)
      }
      return updated
    } finally {
      for (const allocation of pending) {
        for (const protocol of portProtocols(allocation.protocol)) {
          this.#pendingGamePorts.delete(`${protocol}:${allocation.port}`)
        }
      }
    }
  }

  async reserveInstancePort(
    instanceId: string,
    input: RelayInstancePortLeaseRequest
  ): Promise<RelayInstancePortLease> {
    return this.#withGamePortLock(async () => {
      const now = Date.now()
      this.#pruneExpiredPortLeases(now)
      const inspected = await this.#docker.inspectInstances()
      const instance = inspected.find(
        (candidate) => candidate.id === instanceId
      )
      if (!instance) throw new Error("Instance not found")
      if (!instance.managedByRelay) {
        throw new Error(
          "Relay can only reserve ports for containers it created"
        )
      }
      if (instance.brickId === builtinTailscaleBrickId) {
        throw new Error(
          "Configure this Tailscale network from Infrastructure → Tailscale"
        )
      }

      const previous = input.leaseId
        ? this.#portLeases.get(input.leaseId)
        : undefined
      if (previous && previous.instanceId !== instanceId) {
        throw new Error("Port reservation does not belong to this server")
      }
      if (previous) this.#removePendingPort(previous)

      let externalPort: number
      try {
        externalPort = await this.#reserveGamePortUnlocked(
          instanceId,
          input.protocol,
          inspected,
          input.externalPort ?? previous?.externalPort
        )
      } catch (error) {
        if (previous) this.#addPendingPort(previous)
        throw error
      }

      const id = previous?.id ?? randomBytes(16).toString("hex")
      const lease: PortLeaseRecord = {
        expiresAt: Date.now() + PORT_LEASE_TTL_MS,
        externalPort,
        id,
        instanceId,
        protocol: input.protocol,
      }
      this.#portLeases.set(id, lease)
      this.#schedulePortLeaseExpiry(lease)
      return {
        expiresAt: new Date(lease.expiresAt).toISOString(),
        externalPort: lease.externalPort,
        id: lease.id,
        protocol: lease.protocol,
      }
    })
  }

  async releaseInstancePort(
    instanceId: string,
    leaseId: string
  ): Promise<void> {
    await this.#withGamePortLock(() => {
      this.#pruneExpiredPortLeases(Date.now())
      const lease = this.#portLeases.get(leaseId)
      if (!lease) return Promise.resolve()
      if (lease.instanceId !== instanceId) {
        throw new Error("Port reservation does not belong to this server")
      }
      this.#deletePortLease(lease)
      return Promise.resolve()
    })
  }

  async createInstance(input: RelayCreateInstance): Promise<RelayInstance> {
    if (input.recipe === builtinTailscaleBrickSource) {
      throw new Error(
        "Create Tailscale from the Tailscale page so Hearth can place its node deployments"
      )
    }
    const id = randomBytes(32).toString("hex").slice(0, 40)
    return this.#provisionManagedInstance({
      diskLimitBytes: input.diskLimitBytes,
      grandfatheredDiskLimitBytes: 0,
      id,
      prepareDirectory: true,
      recipe: input.recipe,
      start: input.start,
      tailscale: input.tailscale ?? { enabled: false },
      variables: input.variables,
    })
  }

  async reconfigureInstance(
    instanceId: string,
    input: RelayUpdateInstanceStartup
  ): Promise<RelayInstance> {
    const existing = await this.#docker.findInstance(instanceId)
    if (!existing) throw new Error("Instance not found")
    if (!existing.managedByRelay) {
      throw new Error("Relay can only reconfigure containers it created")
    }
    if (existing.brickId === builtinTailscaleBrickId) {
      throw new Error(
        "Configure this Tailscale network from Infrastructure → Tailscale"
      )
    }
    if (!existing.ports.some((allocation) => allocation.kind === "primary")) {
      throw new Error(
        "This server does not have a recoverable primary port. Recreate it before changing startup settings."
      )
    }
    const recipe = input.recipe ?? existing.brickSource
    if (!recipe) {
      throw new Error("Instance is missing its Brick recipe source")
    }
    const diskLimitBytes = input.diskLimitBytes ?? existing.limits.diskBytes
    const tailscale = input.tailscale ?? existing.tailscale
    if (tailscale.enabled) {
      const duplicate = (await this.#docker.inspectInstances()).find(
        (instance) =>
          instance.id !== existing.id &&
          instance.managedByRelay &&
          instance.tailscale.enabled &&
          instance.tailscale.subdomain === tailscale.subdomain
      )
      if (duplicate) {
        throw new Error(
          `The Tailscale address ${tailscale.subdomain} is already assigned to ${duplicate.name}`
        )
      }
    }
    const definition = await this.#bricks.recipe(recipe)
    const resolved = resolveBrick(definition, input.variables, recipe)
    await this.#assertAllocationAvailable({
      checkExistingUsage: true,
      currentDiskLimitBytes: existing.limits.diskBytes,
      directory: join(this.#config.rootDirectory, existing.directory),
      diskLimitBytes,
      existing: (await this.#docker.inspectInstances()).filter(
        (instance) => instance.id !== existing.id
      ),
      memoryLimitBytes: dockerMemoryBytes(resolved.memory),
    })

    await command(
      "docker",
      [
        "stop",
        "--time",
        String(INSTANCE_STOP_TIMEOUT_SECONDS),
        existing.service,
      ],
      {
        timeout: (INSTANCE_STOP_TIMEOUT_SECONDS + 15) * 1_000,
      }
    ).catch(() => undefined)
    await command("docker", ["rm", "--force", existing.service], {
      timeout: 90_000,
    })

    try {
      return await this.#provisionManagedInstance({
        diskLimitBytes,
        grandfatheredDiskLimitBytes: existing.limits.diskBytes,
        id: existing.id,
        prepareDirectory: false,
        ports: existing.ports,
        recipe,
        start: input.start,
        tailscale,
        variables: input.variables,
      })
    } catch (error) {
      throw new Error(
        `Failed to reconfigure ${existing.name}: ${error instanceof Error ? error.message : "unknown error"}`,
        { cause: error }
      )
    }
  }

  async #provisionManagedInstance(input: {
    diskLimitBytes: number
    grandfatheredDiskLimitBytes: number
    id: string
    prepareDirectory: boolean
    ports?: ReadonlyArray<RelayInstancePortAllocation>
    recipe: string
    start: boolean
    tailscale: RelayInstanceTailscale
    variables: RelayCreateInstance["variables"]
  }): Promise<RelayInstance> {
    const definition = await this.#bricks.recipe(input.recipe)
    const resolved = resolveBrick(definition, input.variables, input.recipe)
    const existing = await this.#docker.inspectInstances()
    const memoryLimitBytes = dockerMemoryBytes(resolved.memory)
    if (
      input.tailscale.enabled &&
      existing.some(
        (instance) =>
          instance.managedByRelay &&
          instance.tailscale.enabled &&
          instance.tailscale.subdomain === input.tailscale.subdomain
      )
    ) {
      throw new Error(
        `The Tailscale address ${input.tailscale.subdomain} is already assigned to another server`
      )
    }
    await this.#assertAllocationAvailable({
      checkExistingUsage: !input.prepareDirectory,
      currentDiskLimitBytes: input.grandfatheredDiskLimitBytes,
      directory: join(this.#config.rootDirectory, input.id),
      diskLimitBytes: input.diskLimitBytes,
      existing,
      memoryLimitBytes,
    })
    if (
      input.prepareDirectory &&
      definition.constraints.singleton &&
      existing.some(
        (instance) =>
          instance.managedByRelay &&
          (instance.brickSource === input.recipe ||
            instance.brickId === definition.metadata.id)
      )
    ) {
      throw new Error(
        `This Relay already has the singleton Brick ${definition.metadata.name}`
      )
    }
    const architecture =
      process.arch === "x64"
        ? "amd64"
        : process.arch === "arm64"
          ? "arm64"
          : null
    if (
      definition.constraints.architectures &&
      (!architecture ||
        !definition.constraints.architectures.includes(architecture))
    ) {
      throw new Error(
        `${definition.metadata.name} does not support Relay architecture ${architecture}`
      )
    }

    const id = input.id
    const defaultInstanceName = `kiln-${id.slice(0, 8)}`
    const containerName = this.#resources.instanceContainer(id)
    const version = Object.hasOwn(resolved.values, "version")
      ? String(resolved.values.version)
      : "custom"
    const image = definition.runtime.image
    const memoryLimit = resolved.memory
    const directory = join(this.#config.rootDirectory, id)
    const hostDirectory = join(await this.#hostDataDirectory(), "instances", id)
    const networking = await this.networking()
    const tailscaleSettings = input.tailscale.enabled
      ? await this.tailscaleSettings()
      : null
    if (input.tailscale.enabled && !tailscaleSettings) {
      throw new Error(
        "Configure Tailscale infrastructure before connecting this server"
      )
    }
    const hostnamePrefix = input.tailscale.enabled
      ? input.tailscale.subdomain
      : undefined
    if (input.tailscale.enabled && !hostnamePrefix) {
      throw new Error("Enter a Tailscale subdomain for this server")
    }
    const hostname = hostnamePrefix
      ? `${hostnamePrefix.replace(/\.$/u, "")}.${
          tailscaleSettings?.domain ??
          networking?.domain ??
          this.#config.connectDomain
        }`
      : null
    const primaryPort = definition.network.ports.find(
      (port) => port.name === definition.network.primaryPort
    )
    if (!primaryPort) {
      throw new Error("Brick primary network port disappeared after validation")
    }
    const webRoutes = this.#webRoutes.filter(
      (route) => route.instanceId === input.id
    )
    const proxySettings = await this.proxySettings()
    const routeLabels = this.#containerWebRouteLabels(webRoutes, proxySettings)
    const usesExternalEdge =
      proxySettings.mode === "none" || proxySettings.mode === "coolify"

    if (input.prepareDirectory) {
      await mkdir(directory, { recursive: true })
      if (definition.runtime.user) {
        const identity = definition.runtime.user.split(":")
        const user = Number(identity[0])
        const group = identity.length === 2 ? Number(identity[1]) : user
        await chown(directory, user, group)
      }
    }
    await this.#ensureNetwork()
    if (usesExternalEdge && webRoutes.length > 0) {
      await this.#ensureEdgeNetwork()
    }
    if (networking?.enabled) await this.#ensureInfrastructure(networking, false)
    try {
      await command("docker", ["image", "inspect", image])
    } catch {
      await command("docker", ["pull", image], { timeout: 300_000 })
    }

    if (definition.network.mode === "minecraft-proxy") {
      await this.#writeVelocityConfig(
        directory,
        networking,
        this.#backendRoutes(existing)
      )
    }

    const reservedPorts: Array<{
      port: number
      protocol: RelayInstancePortAllocation["protocol"]
    }> = []
    const portAllocations: Array<RelayInstancePortAllocation> = input.ports
      ? [...input.ports]
      : []
    if (portAllocations.length === 0) {
      const publishedPorts =
        definition.network.mode === "direct"
          ? definition.network.ports
          : [primaryPort]
      for (const port of publishedPorts) {
        const externalPort =
          port.host ??
          (await this.#reserveGamePort(id, port.protocol, existing))
        if (port.host === undefined) {
          reservedPorts.push({ port: externalPort, protocol: port.protocol })
        }
        const primary = port.name === definition.network.primaryPort
        portAllocations.push({
          externalPort,
          id: primary ? "primary" : `brick-${port.name}`,
          internalPort: port.container,
          kind: primary ? "primary" : "brick",
          name: port.name.replaceAll("-", " "),
          protocol: port.protocol,
        })
      }
    }
    const primaryAllocation = portAllocations.find(
      (allocation) => allocation.kind === "primary"
    )
    if (!primaryAllocation) {
      throw new Error("Managed server port allocations require a primary port")
    }
    const portLabels = portAllocationContainerLabels(portAllocations)
    const variablesLabel = JSON.stringify(resolved.values)
    const arguments_ = [
      "container",
      "create",
      "--name",
      containerName,
      "--hostname",
      containerName,
      "--network",
      this.#resources.gameNetwork,
      "--network-alias",
      containerName,
      "--interactive",
      "--tty",
      "--restart",
      "unless-stopped",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,exec,nosuid,nodev,size=128m",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--pids-limit",
      String(definition.runtime.resources.pids),
      "--memory-reservation",
      resolved.memoryReservation,
      "--memory",
      memoryLimit,
      "--memory-swap",
      memoryLimit,
      "--label",
      "kiln.relay.managed=true",
      "--label",
      OWNED_LABEL,
      "--label",
      `kiln.server.id=${id}`,
      "--label",
      `kiln.brick.id=${definition.metadata.id}`,
      "--label",
      `kiln.brick.format=${definition.format}`,
      "--label",
      `kiln.brick.source=${input.recipe}`,
      "--label",
      `kiln.brick.variables=${variablesLabel}`,
      "--label",
      `kiln.brick.network-mode=${definition.network.mode}`,
      "--label",
      `kiln.brick.supports-srv=${definition.network.supportsSrv}`,
      "--label",
      "kiln.traefik.managed=true",
      "--label",
      `kiln.traefik.service.port=${primaryAllocation.internalPort}`,
      "--label",
      `kiln.instance.name=${defaultInstanceName}`,
      "--label",
      `kiln.instance.version=${version}`,
      "--label",
      `kiln.instance.java=${definition.runtime.name}`,
      "--label",
      `kiln.instance.game=${definition.metadata.game}`,
      "--label",
      `kiln.instance.public-host=${this.#config.gameHost}`,
      "--label",
      `kiln.instance.directory=${id}`,
      "--label",
      `kiln.instance.memory-bytes=${memoryLimitBytes}`,
      "--label",
      `kiln.instance.disk-bytes=${input.diskLimitBytes}`,
      "--label",
      `kiln.instance.mount=${definition.runtime.storage.mount}`,
      "--volume",
      `${hostDirectory}:${definition.runtime.storage.mount}`,
    ]
    for (const [label, value] of Object.entries(portLabels)) {
      arguments_.push("--label", `${label}=${value}`)
    }
    if (definition.readiness) {
      arguments_.push(
        "--label",
        `kiln.brick.readiness=${JSON.stringify(definition.readiness)}`
      )
    }
    if (hostname) {
      const privatePort =
        definition.network.mode === "minecraft-proxy"
          ? (tailscaleSettings?.proxyPort ??
            networking?.proxyPort ??
            this.#config.connectPort)
          : definition.network.mode === "direct"
            ? primaryAllocation.internalPort
            : this.#config.connectPort
      arguments_.push(
        "--label",
        `kiln.instance.hostname=${
          privatePort === 25_565 ? hostname : `${hostname}:${privatePort}`
        }`
      )
    }
    arguments_.push(
      "--label",
      `kiln.instance.tailscale-enabled=${input.tailscale.enabled}`
    )
    if (input.tailscale.subdomain) {
      arguments_.push(
        "--label",
        `kiln.instance.tailscale-subdomain=${input.tailscale.subdomain}`
      )
    }
    const ownerLabel = relayOwnerLabel(this.#config)
    if (ownerLabel) arguments_.push("--label", ownerLabel)
    for (const [label, value] of Object.entries(routeLabels)) {
      arguments_.push("--label", `${label}=${value}`)
    }

    if (definition.runtime.workingDirectory) {
      arguments_.push("--workdir", definition.runtime.workingDirectory)
    }
    if (definition.runtime.stopSignal) {
      arguments_.push("--stop-signal", definition.runtime.stopSignal)
    }
    if (definition.runtime.user) {
      arguments_.push("--user", definition.runtime.user)
    }
    if (definition.runtime.entrypoint?.[0]) {
      arguments_.push("--entrypoint", definition.runtime.entrypoint[0])
    }
    for (const [name, value] of Object.entries(resolved.environment)) {
      arguments_.push("--env", `${name}=${value}`)
    }
    for (const [binding, candidates] of Object.entries(
      dockerPortBindingsForAllocations(portAllocations)
    )) {
      const hostPort = candidates[0]?.HostPort
      if (!hostPort) continue
      arguments_.push("--publish", `${hostPort}:${binding}`)
    }
    arguments_.push(image)
    arguments_.push(...(definition.runtime.entrypoint?.slice(1) ?? []))
    arguments_.push(...(definition.runtime.command ?? []))

    try {
      await command("docker", arguments_, { timeout: 60_000 })
      if (usesExternalEdge && webRoutes.length > 0) {
        await command("docker", [
          "network",
          "connect",
          "--alias",
          containerName,
          this.#resources.edgeNetwork,
          containerName,
        ])
      }
      if (input.start) {
        await command("docker", ["start", containerName], { timeout: 120_000 })
      }
      if (networking?.enabled)
        await this.#refreshCoreDnsConfiguration(networking)
      await this.#refreshTailscaleDns()
      if (definition.network.mode === "minecraft-backend")
        await this.#refreshVelocityConfigurations(networking)
    } catch (error) {
      await command("docker", ["rm", "--force", containerName]).catch(
        () => undefined
      )
      if (input.prepareDirectory) {
        await rm(directory, { recursive: true, force: true })
      }
      throw error
    } finally {
      for (const allocation of reservedPorts) {
        for (const protocol of portProtocols(allocation.protocol)) {
          this.#pendingGamePorts.delete(`${protocol}:${allocation.port}`)
        }
      }
    }

    const created = (await this.#docker.inspectInstances()).find(
      (instance) => instance.id === id
    )
    if (!created)
      throw new Error(
        "Docker created the instance but Relay could not discover it"
      )
    return created
  }

  async #reserveGamePort(
    instanceId: string,
    protocol: RelayInstancePortAllocation["protocol"],
    existing: ReadonlyArray<RelayInstance>
  ): Promise<number> {
    return this.#withGamePortLock(() => {
      this.#pruneExpiredPortLeases(Date.now())
      return this.#reserveGamePortUnlocked(instanceId, protocol, existing)
    })
  }

  async #claimPortLease(
    instanceId: string,
    input: RelayInstancePortInput,
    existing: ReadonlyArray<RelayInstance>
  ): Promise<number> {
    if (input.externalPort === undefined || input.leaseId === undefined) {
      return this.#reserveGamePort(instanceId, input.protocol, existing)
    }
    const externalPort = input.externalPort
    const leaseId = input.leaseId
    return this.#withGamePortLock(async () => {
      this.#pruneExpiredPortLeases(Date.now())
      const lease = this.#portLeases.get(leaseId)
      if (!lease) {
        return this.#reserveGamePortUnlocked(
          instanceId,
          input.protocol,
          existing,
          externalPort
        )
      }
      if (lease.instanceId !== instanceId) {
        throw new Error("Port reservation does not belong to this server")
      }
      if (
        lease.externalPort !== externalPort ||
        lease.protocol !== input.protocol
      ) {
        throw new Error("Port reservation no longer matches this allocation")
      }
      this.#consumePortLease(lease)
      return lease.externalPort
    })
  }

  async #reserveGamePortUnlocked(
    instanceId: string,
    protocol: RelayInstancePortAllocation["protocol"],
    existing: ReadonlyArray<RelayInstance>,
    requestedPort?: number
  ): Promise<number> {
    const protocols = portProtocols(protocol)
    const unavailable = new Set<number>()
    for (const candidate of protocols) {
      for (const port of await this.#docker.publishedHostPorts(candidate)) {
        unavailable.add(port)
      }
      const pendingPrefix = `${candidate}:`
      for (const key of this.#pendingGamePorts) {
        if (!key.startsWith(pendingPrefix)) continue
        unavailable.add(Number(key.slice(pendingPrefix.length)))
      }
    }
    for (const instance of existing) {
      const instanceProtocol = instance.brickPrimaryPortProtocol
      if (
        instance.publicPort &&
        instanceProtocol &&
        protocols.some((candidate) =>
          portProtocols(instanceProtocol).includes(candidate)
        )
      ) {
        unavailable.add(instance.publicPort)
      }
    }
    const { end, start } = this.#config.gamePortRange
    if (
      requestedPort !== undefined &&
      (requestedPort < start || requestedPort > end)
    ) {
      throw new Error(
        `Public port must be between ${start} and ${end} on this Relay`
      )
    }
    if (requestedPort !== undefined && unavailable.has(requestedPort)) {
      throw new Error(`Public port ${requestedPort} is already in use`)
    }
    const port =
      requestedPort ??
      nextManagedGamePort({
        end,
        instanceId,
        start,
        unavailable,
      })
    for (const candidate of protocols) {
      this.#pendingGamePorts.add(`${candidate}:${port}`)
    }
    return port
  }

  #addPendingPort(
    allocation: Pick<PortLeaseRecord, "externalPort" | "protocol">
  ): void {
    for (const protocol of portProtocols(allocation.protocol)) {
      this.#pendingGamePorts.add(`${protocol}:${allocation.externalPort}`)
    }
  }

  #removePendingPort(
    allocation: Pick<PortLeaseRecord, "externalPort" | "protocol">
  ): void {
    for (const protocol of portProtocols(allocation.protocol)) {
      this.#pendingGamePorts.delete(`${protocol}:${allocation.externalPort}`)
    }
  }

  #consumePortLease(lease: PortLeaseRecord): void {
    this.#portLeases.delete(lease.id)
    const timer = this.#portLeaseTimers.get(lease.id)
    if (timer) clearTimeout(timer)
    this.#portLeaseTimers.delete(lease.id)
  }

  #deletePortLease(lease: PortLeaseRecord): void {
    this.#consumePortLease(lease)
    this.#removePendingPort(lease)
  }

  #pruneExpiredPortLeases(now: number): void {
    for (const lease of this.#portLeases.values()) {
      if (lease.expiresAt <= now) this.#deletePortLease(lease)
    }
  }

  #schedulePortLeaseExpiry(lease: PortLeaseRecord): void {
    const previous = this.#portLeaseTimers.get(lease.id)
    if (previous) clearTimeout(previous)
    const timer = setTimeout(
      () => {
        void this.#withGamePortLock(() => {
          const current = this.#portLeases.get(lease.id)
          if (current && current.expiresAt <= Date.now()) {
            this.#deletePortLease(current)
          }
          return Promise.resolve()
        })
      },
      Math.max(lease.expiresAt - Date.now(), 0)
    )
    timer.unref()
    this.#portLeaseTimers.set(lease.id, timer)
  }

  #withGamePortLock<Result>(action: () => Promise<Result>): Promise<Result> {
    const result = this.#gamePortMutation.then(action, action)
    this.#gamePortMutation = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  async #assertAllocationAvailable(input: {
    checkExistingUsage: boolean
    currentDiskLimitBytes: number
    directory: string
    diskLimitBytes: number
    existing: ReadonlyArray<RelayInstance>
    memoryLimitBytes: number
  }): Promise<void> {
    const filesystem = await statfs(this.#config.rootDirectory)
    const nodeDiskBytes = filesystem.blocks * filesystem.bsize
    const allocatedMemoryBytes = input.existing.reduce(
      (total, instance) => total + instance.limits.memoryBytes,
      0
    )
    const allocatedDiskBytes = input.existing.reduce(
      (total, instance) => total + instance.limits.diskBytes,
      0
    )

    if (allocatedMemoryBytes + input.memoryLimitBytes > totalmem()) {
      throw new Error(
        `Container memory exceeds the node's assignable capacity (${formatAllocationBytes(Math.max(totalmem() - allocatedMemoryBytes, 0))} available)`
      )
    }
    const availableDiskBytes = relayDiskAllocationAvailableBytes(
      nodeDiskBytes,
      allocatedDiskBytes,
      input.currentDiskLimitBytes
    )
    if (input.diskLimitBytes > availableDiskBytes) {
      throw new Error(
        `Disk quota exceeds the node's assignable capacity (${formatAllocationBytes(availableDiskBytes)} available after the 10 GiB node reserve)`
      )
    }
    if (input.checkExistingUsage) {
      const usedBytes = await directoryApparentSize(input.directory)
      if (usedBytes > input.diskLimitBytes) {
        throw new Error(
          `Disk quota is below this server's current ${formatAllocationBytes(usedBytes)} usage`
        )
      }
    }
  }

  async deleteInstance(
    id: string,
    deleteData: boolean,
    synchronizeTailscaleDns?: (input: {
      mode: "prepare" | "rollback"
      stackIds: ReadonlyArray<string>
    }) => Promise<void>
  ): Promise<void> {
    const instance = await this.#docker.findInstance(id)
    if (!instance) throw new Error("Instance not found")
    if (!instance.managedByRelay) {
      throw new Error("Relay can only delete containers it created")
    }
    if (instance.brickId === builtinTailscaleBrickId) {
      throw new Error(
        "Remove this logical network from Infrastructure → Tailscale so every node is cleaned up"
      )
    }
    const affectedStackIds = (await this.#tailscaleStackConfigs())
      .filter((config) =>
        config.bindings.some((binding) => binding.instanceId === instance.id)
      )
      .map(({ id: stackId }) => stackId)
    if (affectedStackIds.length > 0 && !synchronizeTailscaleDns) {
      throw new Error(
        "Hearth must synchronize peer Tailscale DNS before deleting this server"
      )
    }
    let tailscalePrepareAttempted = false
    let detachedStacks: Array<{
      next: RelayTailscaleStackConfig
      previous: RelayTailscaleStackConfig
      records: Array<{ address: string; hostname: string }>
    }> = []
    try {
      if (affectedStackIds.length > 0) {
        tailscalePrepareAttempted = true
        await synchronizeTailscaleDns?.({
          mode: "prepare",
          stackIds: affectedStackIds,
        })
      }
      detachedStacks = await this.#detachInstanceFromTailscaleStacks(instance)
      await command(
        "docker",
        [
          "stop",
          "--time",
          String(INSTANCE_STOP_TIMEOUT_SECONDS),
          instance.service,
        ],
        {
          timeout: (INSTANCE_STOP_TIMEOUT_SECONDS + 15) * 1_000,
        }
      ).catch(() => undefined)
      await command("docker", ["rm", "--force", instance.service], {
        timeout: 90_000,
      })
    } catch (cause) {
      const rollbackFailures =
        await this.#restoreInstanceTailscaleStacks(detachedStacks)
      if (tailscalePrepareAttempted) {
        try {
          await synchronizeTailscaleDns?.({
            mode: "rollback",
            stackIds: affectedStackIds,
          })
        } catch (rollbackCause) {
          rollbackFailures.push(
            `peer DNS: ${
              rollbackCause instanceof Error
                ? rollbackCause.message
                : "unknown rollback error"
            }`
          )
        }
      }
      throw new Error(
        `Could not delete the server: ${
          cause instanceof Error ? cause.message : "unknown error"
        }${
          rollbackFailures.length > 0
            ? `. Tailscale rollback also failed: ${rollbackFailures.join("; ")}`
            : ""
        }`,
        { cause }
      )
    }
    if (deleteData) {
      await rm(join(this.#config.rootDirectory, instance.directory), {
        recursive: true,
        force: true,
      })
    }
    const networking = await this.networking()
    if (networking?.enabled) await this.#refreshCoreDnsConfiguration(networking)
    await this.#refreshTailscaleDns()
    if (instance.brickNetworkMode === "minecraft-backend")
      await this.#refreshVelocityConfigurations(networking)
  }

  async #ensureNetwork(): Promise<void> {
    await this.#ensureOwnedNetwork(this.#resources.gameNetwork, "game")
  }

  async #ensureInfrastructure(
    networking: RelayNetworking,
    replace = true
  ): Promise<void> {
    await this.#ensureNetwork()
    const infrastructure = join(this.#config.dataDirectory, "infrastructure")
    const hostInfrastructure = join(
      await this.#hostDataDirectory(),
      "infrastructure"
    )
    const coreDns = join(infrastructure, "coredns")
    const limbo = join(infrastructure, "limbo")
    await Promise.all([
      mkdir(coreDns, { recursive: true }),
      mkdir(limbo, { recursive: true }),
    ])
    const instances = await this.#docker.inspectInstances()
    await writeFile(
      join(coreDns, "Corefile"),
      coreDnsConfiguration(
        networking,
        this.#dnsHostnames(instances, networking)
      )
    )
    await writeFile(
      join(limbo, "server.toml"),
      `bind = "0.0.0.0:25565"\nwelcome_message = "<aqua>Starting your Kiln instance…</aqua>"\naction_bar = "<gray>The requested backend is not ready yet.</gray>"\ndefault_game_mode = "spectator"\nfetch_player_skins = false\n\n[forwarding]\nmethod = "NONE"\nsecret = "unused"\n\n[server_list]\nreply_to_status = true\nmax_players = 20\nmessage_of_the_day = "<aqua>Kiln standby</aqua>"\n`
    )

    await this.#ensureContainer(this.#resources.coreDnsContainer, replace, [
      "--network",
      this.#resources.gameNetwork,
      "--network-alias",
      "coredns",
      "--restart",
      "unless-stopped",
      "--publish",
      `${networking.dnsPort}:${networking.dnsPort}/udp`,
      "--publish",
      `${networking.dnsPort}:${networking.dnsPort}/tcp`,
      "--env",
      `KILN_NODE_ADDRESS=${networking.address}`,
      "--volume",
      `${join(hostInfrastructure, "coredns", "Corefile")}:/etc/coredns/Corefile:ro`,
      "coredns/coredns:1.14.2",
      "-conf",
      "/etc/coredns/Corefile",
    ])
    await this.#ensureContainer(this.#resources.limboContainer, replace, [
      "--network",
      this.#resources.gameNetwork,
      "--network-alias",
      "limbo",
      "--restart",
      "unless-stopped",
      "--volume",
      `${join(hostInfrastructure, "limbo", "server.toml")}:/usr/src/app/server.toml:ro`,
      "ghcr.io/quozul/picolimbo:v1.13.1-mc26.2",
    ])
  }

  async #ensureTraefik(
    settings: RelayProxySettings,
    routes: ReadonlyArray<RelayStoredWebRoute>,
    replace: boolean
  ): Promise<void> {
    const diagnostics = await this.proxyDiagnostics(settings)
    const conflicts = diagnostics.ports.filter((port) => !port.available)
    if (conflicts.length > 0) {
      throw new Error(
        conflicts
          .map(
            (port) =>
              `Bundled Traefik cannot start because port ${port.port} is already in use by ${port.owner ?? "another process"}. Choose KILN_RELAY_PROXY=none for an existing proxy, or free ports 80 and 443.`
          )
          .join(" ")
      )
    }

    await this.#ensureNetwork()
    await this.#ensureRelayEdgeNetwork()
    const relayContainer = requiredRelayContainerReference()
    await connectNetworkWithAlias(
      relayContainer,
      this.#resources.relayEdgeNetwork,
      this.#resources.relayEdgeAlias
    )
    const infrastructure = join(
      this.#config.dataDirectory,
      "infrastructure",
      "traefik"
    )
    const hostInfrastructure = join(
      await this.#hostDataDirectory(),
      "infrastructure",
      "traefik"
    )
    await Promise.all([
      mkdir(join(infrastructure, "dynamic"), {
        recursive: true,
        mode: 0o700,
      }),
      mkdir(join(infrastructure, "state"), {
        recursive: true,
        mode: 0o700,
      }),
    ])
    await Promise.all([
      writeFile(
        join(infrastructure, "traefik.yaml"),
        traefikStaticConfiguration(settings),
        { mode: 0o600 }
      ),
      writeFile(
        join(infrastructure, "dynamic", "kiln.yaml"),
        traefikDynamicConfiguration(this.#config, routes, settings),
        { mode: 0o600 }
      ),
      ensureProtectedFile(join(infrastructure, "state", "acme.json")),
    ])

    const arguments_ = [
      "--network",
      this.#resources.relayEdgeNetwork,
      "--restart",
      "unless-stopped",
      "--label",
      "kiln.relay.infrastructure=traefik",
      "--publish",
      "80:80",
      "--publish",
      "443:443",
      "--volume",
      `${join(hostInfrastructure, "traefik.yaml")}:/etc/traefik/traefik.yaml:ro`,
      "--volume",
      `${join(hostInfrastructure, "dynamic")}:/etc/traefik/dynamic:ro`,
      "--volume",
      `${join(hostInfrastructure, "state")}:/var/lib/traefik`,
    ]
    arguments_.push(settings.traefikImage)
    try {
      await this.#ensureContainer(
        this.#resources.traefikContainer,
        replace,
        arguments_
      )
      await connectNetwork(
        this.#resources.traefikContainer,
        this.#resources.relayEdgeNetwork
      )
      await connectNetwork(
        this.#resources.traefikContainer,
        this.#resources.gameNetwork
      )
    } catch (cause) {
      if (isPortBindingFailure(cause)) {
        throw new Error(
          "Bundled Traefik could not bind ports 80 and 443. A host process may already own one of them even though Docker could not identify it. Free both ports or choose KILN_RELAY_PROXY=none for an existing/manual Traefik setup.",
          { cause }
        )
      }
      throw cause
    }
  }

  async #reconcileExternalTraefikRoutes(
    routes: ReadonlyArray<RelayStoredWebRoute>,
    settings: RelayProxySettings
  ): Promise<void> {
    await this.#removeExternalTraefikRoutes()
    if (routes.length === 0) {
      await this.#disableExternalEdge(settings)
      return
    }
    await this.#ensureEdgeNetwork()
    if (settings.mode === "coolify") {
      const proxy = await this.#externalTraefikContainer(settings)
      if (proxy) await connectNetwork(proxy, this.#resources.edgeNetwork)
    }

    const routedInstances = new Set(routes.map((route) => route.instanceId))
    const instances = await this.#docker.inspectInstances()
    await Promise.all(
      instances
        .filter((instance) => instance.managedByRelay)
        .map((instance) =>
          routedInstances.has(instance.id)
            ? connectNetwork(instance.service, this.#resources.edgeNetwork)
            : disconnectNetwork(instance.service, this.#resources.edgeNetwork)
        )
    )
  }

  async #removeBundledTraefik(): Promise<void> {
    await this.#removeOwnedContainer(this.#resources.traefikContainer)
    const relayContainer = process.env.HOSTNAME?.trim()
    if (relayContainer) {
      await disconnectNetwork(relayContainer, this.#resources.relayEdgeNetwork)
    }
    await this.#removeOwnedNetwork(this.#resources.relayEdgeNetwork)
  }

  async #ensureEdgeNetwork(): Promise<void> {
    await this.#ensureOwnedNetwork(this.#resources.edgeNetwork, "edge")
  }

  async #ensureRelayEdgeNetwork(): Promise<void> {
    await this.#ensureOwnedNetwork(
      this.#resources.relayEdgeNetwork,
      "relay-edge"
    )
  }

  async #externalTraefikContainer(
    settings: RelayProxySettings
  ): Promise<string | null> {
    return discoverExternalTraefikContainer({
      edgeNetwork: this.#resources.edgeNetwork,
      resourceNamespace: this.#config.resourceNamespace,
      settings,
    })
  }

  #externalTraefikProfile(settings: RelayProxySettings): TraefikLabelProfile {
    return settings.mode === "coolify"
      ? {
          certificateResolver: "letsencrypt",
          httpEntryPoint: "http",
          httpsEntryPoint: "https",
        }
      : {
          certificateResolver: "kiln",
          httpEntryPoint: "web",
          httpsEntryPoint: "websecure",
        }
  }

  #containerWebRouteLabels(
    routes: ReadonlyArray<RelayInstanceWebRoute>,
    settings: RelayProxySettings
  ): Record<string, string> {
    if (settings.mode === "none" || settings.mode === "coolify") {
      return traefikRouteLabels(
        routes,
        this.#externalTraefikProfile(settings),
        this.#resources.edgeNetwork
      )
    }
    return recoveryRouteLabels(routes)
  }

  #scheduleEdgeReconciliation(settings: RelayProxySettings): void {
    if (this.#edgeReconciliationTimer) {
      clearInterval(this.#edgeReconciliationTimer)
      this.#edgeReconciliationTimer = null
    }
    if (settings.mode !== "coolify") return
    this.#edgeReconciliationTimer = setInterval(() => {
      if (this.#edgeReconciliationPending) return
      this.#edgeReconciliationPending = true
      void this.#serializeEdgeMutation(() =>
        this.#reconcileExternalTraefikRoutes(this.#webRoutes, settings)
      )
        .catch((cause: unknown) => {
          console.error(
            "Relay could not reconcile the Coolify Traefik edge",
            cause
          )
        })
        .finally(() => {
          this.#edgeReconciliationPending = false
        })
    }, 30_000)
    this.#edgeReconciliationTimer.unref()
  }

  #serializeEdgeMutation(operation: () => Promise<void>): Promise<void> {
    const result = this.#edgeMutation.catch(() => undefined).then(operation)
    this.#edgeMutation = result.catch(() => undefined)
    return result
  }

  async #disableExternalEdge(settings: RelayProxySettings): Promise<void> {
    const instances = await this.#docker.inspectInstances()
    const proxy = await this.#externalTraefikContainer(settings)
    await Promise.all([
      ...instances
        .filter((instance) => instance.managedByRelay)
        .map((instance) =>
          disconnectNetwork(instance.service, this.#resources.edgeNetwork)
        ),
      ...(proxy ? [disconnectNetwork(proxy, this.#resources.edgeNetwork)] : []),
    ])
    await this.#removeOwnedNetwork(this.#resources.edgeNetwork)
  }

  async #removeExternalTraefikRoutes(): Promise<void> {
    const result = await command("docker", [
      "ps",
      "--all",
      "--filter",
      "label=kiln.relay.web-route=true",
      "--format",
      "{{.Names}}",
    ])
    const names = result.stdout
      .split("\n")
      .map((name) => name.trim())
      .filter((name) =>
        name.startsWith(
          this.#config.resourceNamespace
            ? `${this.#config.resourceNamespace}-kiln-route-`
            : "kiln-route-"
        )
      )
    await Promise.all(names.map((name) => this.#removeOwnedContainer(name)))
  }

  async #removeInfrastructure(): Promise<void> {
    await Promise.all(
      [this.#resources.coreDnsContainer, this.#resources.limboContainer].map(
        (name) => this.#removeOwnedContainer(name)
      )
    )
  }

  async #refreshCoreDnsConfiguration(
    networking: RelayNetworking
  ): Promise<void> {
    const instances = await this.#docker.inspectInstances()
    await writeFile(
      join(this.#config.dataDirectory, "infrastructure", "coredns", "Corefile"),
      coreDnsConfiguration(
        networking,
        this.#dnsHostnames(instances, networking)
      )
    )
    await command("docker", ["restart", this.#resources.coreDnsContainer], {
      timeout: 90_000,
    })
  }

  #dnsHostnames(
    instances: Array<RelayInstance>,
    networking: RelayNetworking
  ): Array<string> {
    const routes = this.#backendRoutes(instances)
    return [
      ...instances
        .filter((instance) => instance.managedByRelay)
        .map((instance) => instance.connectAddress.split(":")[0] ?? ""),
      ...routes.map((route) => `${route.implementation}.${networking.domain}`),
    ]
  }

  #tailscaleContainerArguments(
    settings: RelayTailscaleSettings,
    hostInfrastructure: string,
    authenticate = false
  ): Array<string> {
    const arguments_ = [
      "--network",
      "host",
      "--restart",
      "unless-stopped",
      "--cap-add",
      "NET_ADMIN",
      "--cap-add",
      "NET_RAW",
      "--device",
      "/dev/net/tun:/dev/net/tun",
      "--env",
      "TS_AUTH_ONCE=true",
      "--env",
      "TS_KUBE_SECRET=",
      "--env",
      "TS_STATE_DIR=/var/lib/tailscale",
      "--env",
      "TS_USERSPACE=false",
      "--env",
      `TS_HOSTNAME=${settings.hostname}`,
      "--volume",
      `${join(hostInfrastructure, "tailscale", "state")}:/var/lib/tailscale`,
    ]
    if (authenticate) arguments_.push("--env", "TS_AUTHKEY")
    arguments_.push(TAILSCALE_IMAGE)
    return arguments_
  }

  async #waitForTailscaleConnection(
    timeoutMs: number
  ): Promise<RelayTailscaleOverview> {
    const deadline = Date.now() + timeoutMs
    let overview = await this.tailscaleOverview()
    while (!overview.status.connected && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1_000)
      })
      overview = await this.tailscaleOverview()
    }
    return overview
  }

  async #ensureTailscaleDns(
    settings: RelayTailscaleSettings,
    address: string | null,
    replace: boolean
  ): Promise<void> {
    if (!address) throw new Error("Tailscale has not assigned a node address")
    const infrastructure = join(this.#config.dataDirectory, "infrastructure")
    const hostInfrastructure = join(
      await this.#hostDataDirectory(),
      "infrastructure"
    )
    const coreDns = join(infrastructure, "coredns")
    await mkdir(coreDns, { recursive: true })
    const instances = await this.#docker.inspectInstances()
    const hostnames = instances
      .filter(
        (instance) => instance.managedByRelay && instance.tailscale.enabled
      )
      .map((instance) => instance.connectAddress.split(":")[0] ?? "")
    await writeFile(
      join(coreDns, "Corefile"),
      tailscaleCoreDnsConfiguration(settings, address, hostnames)
    )
    await this.#ensureContainer(this.#resources.coreDnsContainer, replace, [
      "--network",
      "host",
      "--restart",
      "unless-stopped",
      "--env",
      `KILN_NODE_ADDRESS=${address}`,
      "--volume",
      `${join(hostInfrastructure, "coredns", "Corefile")}:/etc/coredns/Corefile:ro`,
      "coredns/coredns:1.14.2",
      "-conf",
      "/etc/coredns/Corefile",
    ])
  }

  async #refreshTailscaleDns(): Promise<void> {
    const overview = await this.tailscaleOverview()
    if (
      !overview.settings ||
      !overview.status.connected ||
      !overview.status.dnsAddress
    ) {
      return
    }
    await this.#ensureTailscaleDns(
      overview.settings,
      overview.status.dnsAddress,
      true
    )
  }

  async #readTailscaleStackConfig(
    id: string
  ): Promise<RelayTailscaleStackConfig | null> {
    try {
      return relayTailscaleStackConfigSchema.parse(
        JSON.parse(
          await readFile(
            join(this.#config.rootDirectory, id, "stack.json"),
            "utf8"
          )
        )
      )
    } catch (cause) {
      if (hasErrorCode(cause, "ENOENT")) return null
      throw cause
    }
  }

  async #tailscaleStackConfigs(): Promise<Array<RelayTailscaleStackConfig>> {
    const entries = await readdir(this.#config.rootDirectory, {
      encoding: "utf8",
      withFileTypes: true,
    }).catch((cause: unknown) => {
      if (hasErrorCode(cause, "ENOENT")) return []
      throw cause
    })
    const configs = await Promise.all(
      entries
        .filter(
          (entry) => entry.isDirectory() && /^[a-f0-9]{40}$/u.test(entry.name)
        )
        .map((entry) => this.#readTailscaleStackConfig(entry.name))
    )
    const found = configs.filter(
      (config): config is RelayTailscaleStackConfig => config !== null
    )
    for (const config of found) this.#tailscaleConfigs.set(config.id, config)
    this.#tailscaleConfigsDiscovered = true
    return found
  }

  async #knownTailscaleStackConfigs(): Promise<
    Array<RelayTailscaleStackConfig>
  > {
    if (!this.#tailscaleConfigsDiscovered) {
      await this.#tailscaleStackConfigs()
    }
    return [...this.#tailscaleConfigs.values()]
  }

  async #writeTailscaleStackConfig(
    config: RelayTailscaleStackConfig
  ): Promise<void> {
    const directory = join(this.#config.rootDirectory, config.id)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(
      join(directory, "stack.json"),
      `${JSON.stringify(config, null, 2)}\n`,
      { mode: 0o600 }
    )
    this.#tailscaleConfigs.set(config.id, config)
    this.#tailscaleConfigsDiscovered = true
  }

  async #ensureTailscaleStackNetwork(
    config: RelayTailscaleStackConfig
  ): Promise<void> {
    const name = this.#resources.tailscaleStackNetwork(config.id)
    const inspected = await command("docker", [
      "network",
      "inspect",
      "--format",
      "{{json .Labels}}",
      name,
    ]).catch(() => null)
    if (inspected) {
      const labels = stringLabels(JSON.parse(inspected.stdout))
      if (
        labels["kiln.relay.network"] !== `tailscale:${config.id}` ||
        !relayOwnsLabels(this.#config, labels)
      ) {
        throw new Error(
          `Docker network ${name} exists but is not owned by this Tailscale stack`
        )
      }
      return
    }
    const arguments_ = [
      "network",
      "create",
      "--driver",
      "bridge",
      "--subnet",
      config.subnet,
      "--label",
      `kiln.relay.network=tailscale:${config.id}`,
    ]
    const ownerLabel = relayOwnerLabel(this.#config)
    if (ownerLabel) arguments_.push("--label", ownerLabel)
    arguments_.push(name)
    await command("docker", arguments_)
  }

  async #reconcileTailscaleStackBindings(
    stackId: string,
    previous: ReadonlyArray<RelayTailscaleStackConfig["bindings"][number]>,
    desired: ReadonlyArray<RelayTailscaleStackConfig["bindings"][number]>
  ): Promise<void> {
    const network = this.#resources.tailscaleStackNetwork(stackId)
    const previousById = new Map(
      previous.map((binding) => [binding.instanceId, binding])
    )
    const desiredById = new Map(
      desired.map((binding) => [binding.instanceId, binding])
    )
    for (const binding of previous) {
      const replacement = desiredById.get(binding.instanceId)
      if (replacement?.address === binding.address) continue
      const instance = await this.#docker.findInstance(binding.instanceId)
      if (!instance) continue
      await command("docker", [
        "network",
        "disconnect",
        "--force",
        network,
        instance.service,
      ]).catch(() => undefined)
    }
    for (const binding of desired) {
      const prior = previousById.get(binding.instanceId)
      const instance = await this.#docker.findInstance(binding.instanceId)
      if (!instance) continue
      if (
        prior?.address === binding.address &&
        (await containerUsesNetwork(instance.service, network))
      ) {
        continue
      }
      if (await containerUsesNetwork(instance.service, network)) {
        await command("docker", [
          "network",
          "disconnect",
          "--force",
          network,
          instance.service,
        ])
      }
      await command("docker", [
        "network",
        "connect",
        "--ip",
        binding.address,
        network,
        instance.service,
      ])
    }
  }

  async #installTailscaleStack(
    config: RelayTailscaleStackConfig,
    authKey: string
  ): Promise<void> {
    const stateDirectory = join(
      this.#config.dataDirectory,
      "infrastructure",
      "tailscale-stacks",
      config.id,
      "state"
    )
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
    for (const image of [TAILSCALE_IMAGE, COREDNS_IMAGE]) {
      await command("docker", ["image", "inspect", image]).catch(() =>
        command("docker", ["pull", image], { timeout: 300_000 })
      )
    }
    const name = this.#resources.tailscaleStackContainer(config.id)
    try {
      await this.#replaceContainer(
        name,
        await this.#tailscaleStackContainerArguments(config, true),
        { ...process.env, TS_AUTHKEY: authKey }
      )
      if (!(await this.#waitForTailscaleStackConnection(config.id, 90_000))) {
        throw new Error("Tailscale did not connect in time")
      }
      // Remove the one-time key from Docker metadata after the persisted
      // machine identity has authenticated.
      await this.#replaceContainer(
        name,
        await this.#tailscaleStackContainerArguments(config, false)
      )
      if (!(await this.#waitForTailscaleStackConnection(config.id, 45_000))) {
        throw new Error(
          "Tailscale did not reconnect with its persisted identity"
        )
      }
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message.replaceAll(authKey, "[REDACTED]")
          : "unknown error"
      throw new Error(message)
    }
  }

  async #tailscaleStackContainerArguments(
    config: RelayTailscaleStackConfig,
    includeAuthKey: boolean
  ): Promise<Array<string>> {
    const hostRoot = await this.#hostDataDirectory()
    const arguments_ = [
      "--hostname",
      config.hostname,
      "--network",
      this.#resources.tailscaleStackNetwork(config.id),
      "--ip",
      tailscaleStackServiceAddress(config.subnet),
      "--restart",
      "unless-stopped",
      "--cap-add",
      "NET_ADMIN",
      "--cap-add",
      "NET_RAW",
      "--device",
      "/dev/net/tun:/dev/net/tun",
      "--sysctl",
      "net.ipv4.ip_forward=1",
      "--sysctl",
      "net.ipv6.conf.all.forwarding=1",
      "--pids-limit",
      "128",
      "--memory-reservation",
      "16m",
      "--memory",
      "64m",
      "--memory-swap",
      "64m",
      "--label",
      "kiln.relay.managed=true",
      "--label",
      OWNED_LABEL,
      "--label",
      `kiln.server.id=${config.id}`,
      "--label",
      `kiln.brick.id=${builtinTailscaleBrickId}`,
      "--label",
      "kiln.brick.format=kiln.brick/v1",
      "--label",
      `kiln.brick.source=${builtinTailscaleBrickSource}`,
      "--label",
      "kiln.brick.variables={}",
      "--label",
      "kiln.brick.network-mode=direct",
      "--label",
      "kiln.brick.primary-port=53",
      "--label",
      `kiln.instance.name=${config.name}`,
      "--label",
      "kiln.instance.version=stable",
      "--label",
      "kiln.instance.java=Tailscale + CoreDNS",
      "--label",
      "kiln.instance.game=Networking",
      "--label",
      `kiln.instance.hostname=${config.hostname}.${config.domain}`,
      "--label",
      `kiln.instance.directory=${config.id}`,
      "--label",
      `kiln.instance.memory-bytes=${TAILSCALE_STACK_MEMORY_BYTES}`,
      "--label",
      `kiln.instance.disk-bytes=${TAILSCALE_STACK_DISK_BYTES}`,
      "--label",
      "kiln.instance.mount=/config",
      "--volume",
      `${join(hostRoot, "instances", config.id)}:/config`,
      "--volume",
      `${join(hostRoot, "infrastructure", "tailscale-stacks", config.id, "state")}:/var/lib/tailscale`,
      "--env",
      "TS_STATE_DIR=/var/lib/tailscale",
      "--env",
      "TS_USERSPACE=false",
      "--env",
      "TS_ACCEPT_DNS=false",
      "--env",
      "TS_AUTH_ONCE=true",
      "--env",
      `TS_HOSTNAME=${config.hostname}`,
      "--env",
      "TS_EXTRA_ARGS=--accept-dns=false",
    ]
    if (includeAuthKey) {
      arguments_.push("--env", "TS_AUTHKEY")
    }
    arguments_.push(TAILSCALE_IMAGE)
    return arguments_
  }

  async #restartTailscaleStack(
    config: RelayTailscaleStackConfig
  ): Promise<void> {
    await this.#removeOwnedContainer(
      this.#resources.tailscaleStackDnsContainer(config.id)
    )
    await this.#replaceContainer(
      this.#resources.tailscaleStackContainer(config.id),
      await this.#tailscaleStackContainerArguments(config, false)
    )
    if (!(await this.#waitForTailscaleStackConnection(config.id, 45_000))) {
      throw new Error("Tailscale did not reconnect with its persisted identity")
    }
  }

  async #configureTailscaleStackRouting(
    config: RelayTailscaleStackConfig
  ): Promise<void> {
    await this.#ensureTailscaleStackFirewall(config)
    const container = this.#resources.tailscaleStackContainer(config.id)
    await command(
      "docker",
      [
        "exec",
        container,
        "tailscale",
        "set",
        `--hostname=${config.hostname}`,
        `--advertise-routes=${config.subnet}`,
      ],
      { timeout: 30_000 }
    )
  }

  async #ensureTailscaleStackFirewall(
    config: RelayTailscaleStackConfig
  ): Promise<void> {
    const container = this.#resources.tailscaleStackContainer(config.id)
    const chain = TAILSCALE_STACK_FORWARD_CHAIN
    const [hook, specification] = await Promise.all([
      command("docker", [
        "exec",
        container,
        "iptables",
        "-C",
        "FORWARD",
        "-i",
        "tailscale0",
        "-j",
        chain,
      ]).catch(() => null),
      command("docker", ["exec", container, "iptables", "-S", chain]).catch(
        () => null
      ),
    ])
    if (
      specification &&
      tailscaleStackFirewallIsCurrent(
        Boolean(hook),
        specification.stdout,
        config.bindings
      )
    ) {
      return
    }
    await command("docker", ["exec", container, "iptables", "-N", chain]).catch(
      () => undefined
    )
    if (!hook) {
      await command("docker", [
        "exec",
        container,
        "iptables",
        "-I",
        "FORWARD",
        "1",
        "-i",
        "tailscale0",
        "-j",
        chain,
      ])
    }
    await command("docker", ["exec", container, "iptables", "-F", chain])
    for (const rule of tailscaleStackFirewallRules(config.bindings)) {
      await command("docker", ["exec", container, "iptables", ...rule])
    }
  }

  async #rollbackTailscaleStackApply(
    attempted: RelayTailscaleStackConfig,
    existing: RelayTailscaleStackConfig | null,
    previousDnsRecords: ReadonlyArray<{ address: string; hostname: string }>
  ): Promise<void> {
    if (existing) {
      await this.#writeTailscaleStackConfig(existing)
      await this.#restartTailscaleStack(existing)
      await this.#reconcileTailscaleStackBindings(
        existing.id,
        attempted.bindings,
        existing.bindings
      )
      await this.#configureTailscaleStackRouting(existing)
      await this.#ensureTailscaleStackDns(existing, previousDnsRecords)
      return
    }

    if (
      await this.#containerExists(
        this.#resources.tailscaleStackContainer(attempted.id)
      )
    ) {
      await this.#prepareTailscaleStackRemoval(attempted.id)
      await this.#commitTailscaleStackRemoval(attempted.id)
      return
    }
    if (await this.#tailscaleStackIdentityExists(attempted.id)) {
      await this.#ensureTailscaleStackNetwork(attempted)
      await this.#replaceContainer(
        this.#resources.tailscaleStackContainer(attempted.id),
        await this.#tailscaleStackContainerArguments(attempted, false)
      )
      await this.#prepareTailscaleStackRemoval(attempted.id)
      await this.#commitTailscaleStackRemoval(attempted.id)
      return
    }

    await this.#reconcileTailscaleStackBindings(
      attempted.id,
      attempted.bindings,
      []
    )
    await this.#removeOwnedContainer(
      this.#resources.tailscaleStackDnsContainer(attempted.id)
    )
    await this.#removeOwnedNetwork(
      this.#resources.tailscaleStackNetwork(attempted.id)
    )
    await rm(join(this.#config.rootDirectory, attempted.id), {
      force: true,
      recursive: true,
    })
    this.#tailscaleConfigs.delete(attempted.id)
    await rm(
      join(
        this.#config.dataDirectory,
        "infrastructure",
        "tailscale-stacks",
        attempted.id
      ),
      { force: true, recursive: true }
    )
  }

  async #ensureTailscaleStackDns(
    config: RelayTailscaleStackConfig,
    records: ReadonlyArray<{ address: string; hostname: string }>
  ): Promise<void> {
    const recordsPath = this.#tailscaleStackDnsRecordsPath(config.id)
    await writeFile(
      recordsPath,
      `${JSON.stringify({ id: config.id, records }, null, 2)}\n`,
      { mode: 0o600 }
    )
    const path = join(this.#config.rootDirectory, config.id, "Corefile")
    await writeFile(
      path,
      tailscaleStackCoreDnsConfiguration(config.domain, records),
      { mode: 0o644 }
    )
    await chmod(path, 0o644)
    const hostPath = join(
      await this.#hostDataDirectory(),
      "instances",
      config.id,
      "Corefile"
    )
    await this.#replaceContainer(
      this.#resources.tailscaleStackDnsContainer(config.id),
      [
        "--network",
        `container:${this.#resources.tailscaleStackContainer(config.id)}`,
        "--restart",
        "unless-stopped",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--cap-add",
        "NET_BIND_SERVICE",
        "--security-opt",
        "no-new-privileges:true",
        "--pids-limit",
        "64",
        "--memory",
        "32m",
        "--volume",
        `${hostPath}:/etc/coredns/Corefile:ro`,
        COREDNS_IMAGE,
        "-conf",
        "/etc/coredns/Corefile",
      ]
    )
  }

  #tailscaleStackDnsRecordsPath(id: string): string {
    return join(this.#config.rootDirectory, id, "dns-records.json")
  }

  async #tailscaleStackIdentityExists(id: string): Promise<boolean> {
    try {
      await access(
        join(
          this.#config.dataDirectory,
          "infrastructure",
          "tailscale-stacks",
          id,
          "state",
          "tailscaled.state"
        )
      )
      return true
    } catch (cause) {
      if (hasErrorCode(cause, "ENOENT")) return false
      throw cause
    }
  }

  async #tailscaleStackContainerGeneration(id: string): Promise<string | null> {
    const inspected = await command("docker", [
      "container",
      "inspect",
      "--format",
      "{{.Id}}|{{.State.StartedAt}}|{{.State.Running}}",
      this.#resources.tailscaleStackContainer(id),
    ]).catch(() => null)
    if (!inspected) return null
    const generation = inspected.stdout.trim()
    return generation.endsWith("|true") ? generation : null
  }

  async #readTailscaleStackDnsRecords(
    config: RelayTailscaleStackConfig
  ): Promise<Array<{ address: string; hostname: string }>> {
    try {
      return relayTailscaleStackDnsSchema.parse(
        JSON.parse(
          await readFile(this.#tailscaleStackDnsRecordsPath(config.id), "utf8")
        )
      ).records
    } catch (cause) {
      if (!hasErrorCode(cause, "ENOENT")) throw cause
    }
    try {
      return tailscaleStackCoreDnsRecords(
        config.domain,
        await readFile(
          join(this.#config.rootDirectory, config.id, "Corefile"),
          "utf8"
        )
      )
    } catch (cause) {
      if (hasErrorCode(cause, "ENOENT")) {
        return config.bindings.map(({ address, hostname }) => ({
          address,
          hostname,
        }))
      }
      throw cause
    }
  }

  async #detachInstanceFromTailscaleStacks(
    instance: RelayInstanceConfig
  ): Promise<
    Array<{
      next: RelayTailscaleStackConfig
      previous: RelayTailscaleStackConfig
      records: Array<{ address: string; hostname: string }>
    }>
  > {
    const configs = (await this.#tailscaleStackConfigs()).filter((config) =>
      config.bindings.some((binding) => binding.instanceId === instance.id)
    )
    const completed: Array<{
      next: RelayTailscaleStackConfig
      previous: RelayTailscaleStackConfig
      records: Array<{ address: string; hostname: string }>
    }> = []
    try {
      for (const previous of configs) {
        if (await this.#tailscaleStackRemovalPending(previous.id)) {
          throw new Error(
            `Finish removing ${previous.name} from Tailscale before deleting this server`
          )
        }
        const records = await this.#readTailscaleStackDnsRecords(previous)
        const detached = tailscaleStackWithoutInstance(
          previous,
          records,
          instance.id
        )
        const next = detached.config
        completed.push({ next, previous, records })
        await this.#reconcileTailscaleStackBindings(
          previous.id,
          previous.bindings,
          next.bindings
        )
        await this.#writeTailscaleStackConfig(next)
        await this.#configureTailscaleStackRouting(next)
        await this.#ensureTailscaleStackDns(next, detached.records)
      }
      return completed
    } catch (cause) {
      const rollbackFailures =
        await this.#restoreInstanceTailscaleStacks(completed)
      throw new Error(
        `Could not remove the server from its Tailscale networks: ${
          cause instanceof Error ? cause.message : "unknown error"
        }${
          rollbackFailures.length > 0
            ? `. Rollback also failed: ${rollbackFailures.join("; ")}`
            : ""
        }`,
        { cause }
      )
    }
  }

  async #restoreInstanceTailscaleStacks(
    changes: ReadonlyArray<{
      next: RelayTailscaleStackConfig
      previous: RelayTailscaleStackConfig
      records: Array<{ address: string; hostname: string }>
    }>
  ): Promise<Array<string>> {
    const failures: Array<string> = []
    for (const change of [...changes].reverse()) {
      try {
        await this.#writeTailscaleStackConfig(change.previous)
        await this.#reconcileTailscaleStackBindings(
          change.previous.id,
          change.next.bindings,
          change.previous.bindings
        )
        await this.#configureTailscaleStackRouting(change.previous)
        await this.#ensureTailscaleStackDns(change.previous, change.records)
      } catch (cause) {
        failures.push(
          cause instanceof Error ? cause.message : "unknown rollback error"
        )
      }
    }
    return failures
  }

  async #waitForTailscaleStackConnection(
    id: string,
    timeoutMs: number
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const status = await this.#tailscaleStackAddresses(id)
      if (status.ipv4Address || status.ipv6Address) return true
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000))
    }
    return false
  }

  async #tailscaleStackAddresses(id: string): Promise<{
    ipv4Address: string | null
    ipv6Address: string | null
  }> {
    const name = this.#resources.tailscaleStackContainer(id)
    const [ipv4, ipv6] = await Promise.all([
      command("docker", ["exec", name, "tailscale", "ip", "-4"], {
        timeout: 10_000,
      }).catch(() => null),
      command("docker", ["exec", name, "tailscale", "ip", "-6"], {
        timeout: 10_000,
      }).catch(() => null),
    ])
    return {
      ipv4Address: ipv4?.stdout.trim().split("\n")[0] || null,
      ipv6Address: ipv6?.stdout.trim().split("\n")[0] || null,
    }
  }

  async #tailscaleStack(
    config: RelayTailscaleStackConfig
  ): Promise<RelayTailscaleStack> {
    if (await this.#tailscaleStackRemovalPending(config.id)) {
      const snapshot = await this.#readTailscaleStackRemovalSnapshot(config.id)
      if (!snapshot) {
        throw new Error(
          `Tailscale stack ${config.name} is pending removal but its recovery snapshot is missing`
        )
      }
      return tailscaleStackPendingRemoval(config, snapshot)
    }
    const instance = (await this.#docker.inspectInstances()).find(
      (candidate) => candidate.id === config.id
    )
    if (!instance) {
      throw new Error(
        `Tailscale stack ${config.name} is configured but its container is missing`
      )
    }
    const [addresses, tailscaleRunning, coreDnsRunning] = await Promise.all([
      this.#tailscaleStackAddresses(config.id),
      this.#containerRunning(
        this.#resources.tailscaleStackContainer(config.id)
      ),
      this.#containerRunning(
        this.#resources.tailscaleStackDnsContainer(config.id)
      ),
    ])
    const connected = Boolean(addresses.ipv4Address || addresses.ipv6Address)
    return relayTailscaleStackSchema.parse({
      ...config,
      components: { coreDnsRunning, tailscaleRunning },
      instance,
      status: {
        connected,
        ipv4Address: addresses.ipv4Address,
        ipv6Address: addresses.ipv6Address,
        message: connected
          ? null
          : tailscaleRunning
            ? "Waiting for Tailscale"
            : "Tailscale is stopped",
      },
    })
  }

  async #containerExists(name: string): Promise<boolean> {
    const inspected = await command("docker", [
      "container",
      "inspect",
      "--format",
      "{{.Id}}",
      name,
    ]).catch(() => null)
    return Boolean(inspected?.stdout.trim())
  }

  async #containerRunning(name: string): Promise<boolean> {
    const inspected = await command("docker", [
      "container",
      "inspect",
      "--format",
      "{{.State.Running}}",
      name,
    ]).catch(() => null)
    return inspected?.stdout.trim() === "true"
  }

  async #replaceContainer(
    name: string,
    arguments_: Array<string>,
    env?: NodeJS.ProcessEnv
  ): Promise<void> {
    await this.#removeOwnedContainer(name)
    const ownedArguments = [...arguments_]
    const ownerLabel = relayOwnerLabel(this.#config)
    if (ownerLabel) ownedArguments.unshift("--label", ownerLabel)
    await command(
      "docker",
      ["run", "--detach", "--name", name, ...ownedArguments],
      {
        env,
        timeout: 180_000,
      }
    )
  }

  async #ensureContainer(
    name: string,
    replace: boolean,
    arguments_: Array<string>
  ): Promise<void> {
    if (!replace) {
      const inspected = await command("docker", [
        "container",
        "inspect",
        "--format",
        "{{json .Config.Labels}}",
        name,
      ]).catch(() => null)
      if (inspected) {
        if (
          !relayOwnsLabels(
            this.#config,
            stringLabels(JSON.parse(inspected.stdout))
          )
        ) {
          throw new Error(
            `Docker container ${name} exists but is not owned by this Relay`
          )
        }
        return
      }
    }
    await this.#replaceContainer(name, arguments_)
  }

  async #removeOwnedContainer(name: string): Promise<void> {
    const inspected = await command("docker", [
      "container",
      "inspect",
      "--format",
      "{{json .Config.Labels}}",
      name,
    ]).catch(() => null)
    if (!inspected) return
    const labels = stringLabels(JSON.parse(inspected.stdout))
    if (!relayOwnsLabels(this.#config, labels)) {
      throw new Error(
        `Docker container ${name} is not owned by this Relay and will not be removed`
      )
    }
    await command("docker", ["rm", "--force", name])
  }

  async #ensureOwnedNetwork(name: string, kind: string): Promise<void> {
    const inspected = await command("docker", [
      "network",
      "inspect",
      "--format",
      "{{json .Labels}}",
      name,
    ]).catch(() => null)
    if (inspected) {
      const labels = stringLabels(JSON.parse(inspected.stdout))
      const legacyGameNetwork =
        !this.#config.resourceNamespace &&
        kind === "game" &&
        labels["kiln.relay.network"] === undefined
      if (
        (!legacyGameNetwork && labels["kiln.relay.network"] !== kind) ||
        !relayOwnsLabels(this.#config, labels)
      ) {
        throw new Error(
          `Docker network ${name} already exists but is not owned by this Relay`
        )
      }
      return
    }
    const arguments_ = [
      "network",
      "create",
      "--label",
      `kiln.relay.network=${kind}`,
    ]
    const ownerLabel = relayOwnerLabel(this.#config)
    if (ownerLabel) arguments_.push("--label", ownerLabel)
    arguments_.push(name)
    await command("docker", arguments_)
  }

  async #removeOwnedNetwork(name: string): Promise<void> {
    const inspected = await command("docker", [
      "network",
      "inspect",
      "--format",
      "{{json .Labels}}",
      name,
    ]).catch(() => null)
    if (!inspected) return
    const labels = stringLabels(JSON.parse(inspected.stdout))
    if (!relayOwnsLabels(this.#config, labels)) {
      throw new Error(
        `Docker network ${name} is not owned by this Relay and will not be removed`
      )
    }
    await command("docker", ["network", "rm", name])
  }

  async #hostDataDirectory(): Promise<string> {
    this.#hostDataDirectoryPromise ??= this.#resolveHostDataDirectory()
    return this.#hostDataDirectoryPromise
  }

  async #resolveHostDataDirectory(): Promise<string> {
    const containerId = process.env.HOSTNAME?.trim()
    if (containerId) {
      try {
        const inspected = await command("docker", ["inspect", containerId])
        const containers = JSON.parse(inspected.stdout) as Array<{
          Mounts?: Array<{ Destination: string; Source: string }>
        }>
        const dataMount = containers[0]?.Mounts?.find(
          (mount) => mount.Destination === this.#config.dataDirectory
        )
        if (dataMount?.Source) return dataMount.Source
      } catch {
        // A host-run Relay can use its local data path directly.
      }
    }
    return this.#config.dataDirectory
  }

  async #refreshVelocityConfigurations(
    networking: RelayNetworking | null
  ): Promise<void> {
    const instances = await this.#docker.inspectInstances()
    const routes = this.#backendRoutes(instances)
    for (const proxy of instances.filter(
      (instance) =>
        instance.managedByRelay &&
        instance.brickNetworkMode === "minecraft-proxy"
    )) {
      await this.#writeVelocityConfig(
        join(this.#config.rootDirectory, proxy.directory),
        networking,
        routes
      )
      if (proxy.observedState === "running") {
        await command("docker", ["restart", proxy.service], { timeout: 90_000 })
      }
    }
  }

  #backendRoutes(instances: Array<RelayInstance>): Array<BackendRoute> {
    return instances
      .filter(
        (instance) =>
          instance.managedByRelay &&
          instance.brickNetworkMode === "minecraft-backend"
      )
      .map((instance) => ({
        hostname: instance.connectAddress.split(":")[0] ?? instance.name,
        implementation:
          instance.brickId ?? instance.implementation.toLowerCase(),
        name: instance.name,
        target: `${instance.service}:${instance.brickPrimaryPort ?? 25_565}`,
        version: instance.version,
      }))
  }

  async #writeVelocityConfig(
    directory: string,
    networking: RelayNetworking | null,
    routes: Array<BackendRoute>
  ): Promise<void> {
    const tailscale = await this.tailscaleSettings()
    const domain =
      tailscale?.domain ?? networking?.domain ?? this.#config.connectDomain
    const servers = [
      ...routes.map((route) => `"${route.name}" = "${route.target}"`),
      '"limbo" = "limbo:25565"',
    ].join("\n")
    const forcedHosts = velocityForcedHosts(domain, routes)
    await writeFile(
      join(directory, "velocity.toml"),
      `config-version = "2.8"\nbind = "0.0.0.0:25565"\nmotd = "<#f97316>Kiln managed network"\nshow-max-players = 500\nonline-mode = true\nforce-key-authentication = true\nplayer-info-forwarding-mode = "none"\nannounce-forge = false\nping-passthrough = "DISABLED"\nenable-player-address-logging = true\n\n[servers]\n${servers}\ntry = ["limbo"]\n\n[forced-hosts]\n${forcedHosts}\n\n[advanced]\ncompression-threshold = 256\ncompression-level = -1\nlogin-ratelimit = 3000\nconnection-timeout = 5000\nread-timeout = 30000\n\n[query]\nenabled = false\nport = 25565\nmap = "Kiln"\nshow-plugins = false\n`
    )
  }
}

export function velocityForcedHosts(
  domain: string,
  routes: ReadonlyArray<BackendRoute>
): string {
  const byHostname = new Map<string, Array<string>>()
  const addRoute = (hostname: string, name: string): void => {
    const names = byHostname.get(hostname) ?? []
    if (!names.includes(name)) names.push(name)
    byHostname.set(hostname, names)
  }

  for (const route of routes) {
    addRoute(route.hostname, route.name)
    addRoute(`${route.implementation}.${domain}`, route.name)
  }

  return Array.from(
    byHostname,
    ([hostname, names]) =>
      `"${hostname}" = [${names.map((name) => `"${name}"`).join(", ")}, "limbo"]`
  ).join("\n")
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

async function ensureProtectedFile(path: string): Promise<void> {
  try {
    await writeFile(path, "{}\n", { flag: "wx", mode: 0o600 })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause
  }
  await chmod(path, 0o600)
}

type LifecycleCommand = (
  executable: string,
  arguments_: Array<string>
) => Promise<{ stderr: string; stdout: string }>

export async function discoverExternalTraefikContainer(
  input: {
    edgeNetwork: string
    resourceNamespace: string | null
    settings: RelayProxySettings
  },
  runCommand: LifecycleCommand = command
): Promise<string | null> {
  if (input.settings.mode === "coolify") {
    return firstTraefikContainer(["coolify-proxy"], runCommand)
  }
  if (input.resourceNamespace) {
    const attached = await runCommand("docker", [
      "network",
      "inspect",
      "--format",
      "{{range .Containers}}{{println .Name}}{{end}}",
      input.edgeNetwork,
    ]).catch(() => ({ stderr: "", stdout: "" }))
    return firstTraefikContainer(containerNames(attached.stdout), runCommand)
  }

  const candidates = ["coolify-proxy"]
  const ports = await Promise.all(
    [80, 443].map((port) =>
      runCommand("docker", [
        "ps",
        "--filter",
        `publish=${port}`,
        "--format",
        "{{.Names}}",
      ]).catch(() => ({ stderr: "", stdout: "" }))
    )
  )
  for (const result of ports) {
    candidates.push(...containerNames(result.stdout))
  }
  return firstTraefikContainer(Array.from(new Set(candidates)), runCommand)
}

async function firstTraefikContainer(
  names: ReadonlyArray<string>,
  runCommand: LifecycleCommand
): Promise<string | null> {
  for (const name of names) {
    const inspected = await runCommand("docker", [
      "inspect",
      "--format",
      "{{.State.Running}} {{.Config.Image}}",
      name,
    ])
      .then((result) => result.stdout.trim().toLowerCase())
      .catch(() => "")
    if (
      inspected.startsWith("true traefik:") ||
      inspected.startsWith("true traefik@")
    ) {
      return name
    }
  }
  return null
}

function containerNames(output: string): Array<string> {
  return output
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
}

async function containerUsesNetwork(
  name: string,
  network: string
): Promise<boolean> {
  return command("docker", [
    "inspect",
    "--format",
    "{{json .NetworkSettings.Networks}}",
    name,
  ])
    .then((result) => {
      const networks = JSON.parse(result.stdout) as unknown
      return Boolean(
        networks && typeof networks === "object" && network in networks
      )
    })
    .catch(() => false)
}

async function containerLabels(name: string): Promise<Record<string, string>> {
  return command("docker", [
    "inspect",
    "--format",
    "{{json .Config.Labels}}",
    name,
  ])
    .then((result) => stringLabels(JSON.parse(result.stdout)))
    .catch(() => ({}))
}

function stringLabels(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  )
}

async function connectNetwork(name: string, network: string): Promise<void> {
  if (await containerUsesNetwork(name, network)) return
  await command("docker", ["network", "connect", network, name])
}

async function connectNetworkWithAlias(
  name: string,
  network: string,
  alias: string
): Promise<void> {
  if (await containerUsesNetworkAlias(name, network, alias)) return
  if (await containerUsesNetwork(name, network)) {
    await command("docker", ["network", "disconnect", network, name])
  }
  await command("docker", [
    "network",
    "connect",
    "--alias",
    alias,
    network,
    name,
  ])
}

async function containerUsesNetworkAlias(
  name: string,
  network: string,
  alias: string
): Promise<boolean> {
  return command("docker", [
    "inspect",
    "--format",
    "{{json .NetworkSettings.Networks}}",
    name,
  ])
    .then((result) => {
      const networks = JSON.parse(result.stdout) as Record<
        string,
        { Aliases?: unknown }
      >
      const aliases = networks[network]?.Aliases
      return Array.isArray(aliases) && aliases.includes(alias)
    })
    .catch(() => false)
}

async function disconnectNetwork(name: string, network: string): Promise<void> {
  if (!(await containerUsesNetwork(name, network))) return
  await command("docker", ["network", "disconnect", "--force", network, name])
}

export interface TraefikLabelProfile {
  certificateResolver: string
  httpEntryPoint: string
  httpsEntryPoint: string
}

export function traefikRouteLabels(
  routes: ReadonlyArray<RelayInstanceWebRoute>,
  profile: TraefikLabelProfile,
  edgeNetwork = "kiln-edge"
): Record<string, string> {
  const labels: Record<string, string> = {
    ...webRouteRecoveryLabels(routes),
    "traefik.enable": routes.length > 0 ? "true" : "false",
  }
  if (routes.length > 0) labels["traefik.docker.network"] = edgeNetwork

  for (const route of routes) {
    const name = traefikRouteName(route.id)
    const httpRouter = `${name}-http`
    const httpsRouter = `${name}-https`
    const rule = route.path
      ? `Host(\`${route.hostname}\`) && PathPrefix(\`${route.path}\`)`
      : `Host(\`${route.hostname}\`)`
    labels[`traefik.http.routers.${httpRouter}.entrypoints`] =
      profile.httpEntryPoint
    labels[`traefik.http.routers.${httpRouter}.middlewares`] =
      `${name}-redirect`
    labels[`traefik.http.routers.${httpRouter}.priority`] = String(
      route.path ? 100 + route.path.length : 10
    )
    labels[`traefik.http.routers.${httpRouter}.rule`] = rule
    labels[`traefik.http.routers.${httpRouter}.service`] = name
    labels[`traefik.http.middlewares.${name}-redirect.redirectscheme.scheme`] =
      "https"
    labels[
      `traefik.http.middlewares.${name}-redirect.redirectscheme.permanent`
    ] = "true"
    labels[`traefik.http.routers.${httpsRouter}.entrypoints`] =
      profile.httpsEntryPoint
    labels[`traefik.http.routers.${httpsRouter}.priority`] = String(
      route.path ? 100 + route.path.length : 10
    )
    labels[`traefik.http.routers.${httpsRouter}.rule`] = rule
    labels[`traefik.http.routers.${httpsRouter}.service`] = name
    labels[`traefik.http.routers.${httpsRouter}.tls`] = "true"
    labels[`traefik.http.routers.${httpsRouter}.tls.certresolver`] =
      profile.certificateResolver
    labels[`traefik.http.services.${name}.loadbalancer.server.port`] = String(
      route.targetPort
    )
    if (route.path && route.stripPrefix) {
      labels[`traefik.http.routers.${httpsRouter}.middlewares`] =
        `${name}-strip`
      labels[`traefik.http.middlewares.${name}-strip.stripprefix.prefixes`] =
        route.path
    }
  }

  return withWebRouteRevision(labels)
}

export function recoveryRouteLabels(
  routes: ReadonlyArray<RelayInstanceWebRoute>
): Record<string, string> {
  return withWebRouteRevision({
    ...webRouteRecoveryLabels(routes),
    "traefik.enable": "false",
  })
}

export function routeLabelsRequireRestart(
  current: Readonly<Record<string, string>>,
  routes: ReadonlyArray<RelayInstanceWebRoute>,
  desired: Readonly<Record<string, string>>
): boolean {
  if (routes.length > 0) {
    return (
      current[WEB_ROUTE_REVISION_LABEL] !== desired[WEB_ROUTE_REVISION_LABEL]
    )
  }
  const hasManagedRouteLabels =
    current[WEB_ROUTE_REVISION_LABEL] !== undefined ||
    current["traefik.enable"] === "true" ||
    Object.keys(current).some(
      (label) =>
        label.startsWith("traefik.http.") ||
        (label.startsWith(WEB_ROUTE_LABEL_PREFIX) &&
          label !== WEB_ROUTE_REVISION_LABEL)
    )
  return (
    hasManagedRouteLabels &&
    current[WEB_ROUTE_REVISION_LABEL] !== desired[WEB_ROUTE_REVISION_LABEL]
  )
}

function withWebRouteRevision(
  labels: Readonly<Record<string, string>>
): Record<string, string> {
  return {
    ...labels,
    [WEB_ROUTE_REVISION_LABEL]: createHash("sha256")
      .update(
        JSON.stringify(
          Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
        )
      )
      .digest("hex"),
  }
}

export function traefikStaticConfiguration(
  settings: RelayProxySettings
): string {
  const email = settings.acmeEmail
    ? `      email: ${JSON.stringify(settings.acmeEmail)}\n`
    : ""
  return `entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
  websecure:
    address: ":443"

providers:
  file:
    directory: /etc/traefik/dynamic
    watch: true

certificatesResolvers:
  kiln:
    acme:
${email}      storage: /var/lib/traefik/acme.json
      httpChallenge:
        entryPoint: web

api:
  dashboard: false
log:
  level: INFO
accessLog: {}
`
}

export function traefikDynamicConfiguration(
  config: RelayConfig,
  routes: ReadonlyArray<RelayStoredWebRoute>,
  _settings: RelayProxySettings
): string {
  const resources = relayResourceNames(config)
  const lines = ["http:", "  routers:"]
  if (isTraefikHostname(config.advertisedHost)) {
    lines.push(
      "    kiln-relay:",
      `      rule: ${JSON.stringify(`Host(\`${config.advertisedHost}\`)`)}`,
      "      entryPoints:",
      "        - websecure",
      "      service: kiln-relay",
      "      tls:",
      "        certResolver: kiln"
    )
  }
  for (const route of routes) {
    const name = traefikRouteName(route.id)
    const rule = route.path
      ? `Host(\`${route.hostname}\`) && PathPrefix(\`${route.path}\`)`
      : `Host(\`${route.hostname}\`)`
    lines.push(
      `    ${name}:`,
      `      rule: ${JSON.stringify(rule)}`,
      `      priority: ${route.path ? 100 + route.path.length : 10}`,
      "      entryPoints:",
      "        - websecure",
      `      service: ${name}`,
      "      tls:",
      "        certResolver: kiln"
    )
    if (route.path && route.stripPrefix) {
      lines.push("      middlewares:", `        - ${name}-strip`)
    }
  }

  lines.push("  services:")
  if (isTraefikHostname(config.advertisedHost)) {
    lines.push(
      "    kiln-relay:",
      "      loadBalancer:",
      "        servers:",
      `          - url: ${JSON.stringify(`http://${resources.relayEdgeAlias}:${config.port}`)}`
    )
  }
  for (const route of routes) {
    const name = traefikRouteName(route.id)
    lines.push(
      `    ${name}:`,
      "      loadBalancer:",
      "        servers:",
      `          - url: ${JSON.stringify(`http://${resources.instanceContainer(route.instanceId)}:${route.targetPort}`)}`
    )
  }

  lines.push("  middlewares:")
  for (const route of routes) {
    if (!route.path || !route.stripPrefix) continue
    const name = traefikRouteName(route.id)
    lines.push(
      `    ${name}-strip:`,
      "      stripPrefix:",
      "        prefixes:",
      `          - ${JSON.stringify(route.path)}`
    )
  }
  lines.push("")
  return `${lines.join("\n")}\n`
}

function traefikRouteName(id: string): string {
  return `kiln-route-${id.replaceAll("-", "")}`
}

function isTraefikHostname(value: string): boolean {
  return /^[A-Za-z0-9.:[\]-]+$/u.test(value)
}

function formatPublicHost(hostname: string): string {
  return hostname.includes(":") && !hostname.startsWith("[")
    ? `[${hostname}]`
    : hostname
}

function requiredRelayContainerReference(): string {
  const reference = process.env.HOSTNAME?.trim()
  if (reference) return reference
  throw new Error(
    "Bundled Traefik could not identify the Relay container through HOSTNAME"
  )
}

function usesProxyTlsTermination(mode: RelayProxySettings["mode"]): boolean {
  return mode === "coolify" || mode === "traefik"
}

function effectiveUrlPort(url: URL): number {
  if (url.port) return Number(url.port)
  return url.protocol === "https:" ? 443 : 80
}

function isPortBindingFailure(cause: unknown): boolean {
  const message =
    cause && typeof cause === "object" && "message" in cause
      ? String(cause.message)
      : ""
  return /(?:address already in use|bind:|port is already allocated)/iu.test(
    message
  )
}

function hasErrorCode(cause: unknown, code: string): boolean {
  return (
    cause !== null &&
    typeof cause === "object" &&
    "code" in cause &&
    cause.code === code
  )
}

export function coreDnsHostnamePattern(
  domain: string,
  hostnames: ReadonlyArray<string>
): string {
  const suffix = `.${domain}`
  const names = Array.from(
    new Set(
      hostnames
        .map((hostname) => hostname.toLowerCase().replace(/\.$/u, ""))
        .filter((hostname) => hostname.endsWith(suffix))
    )
  ).sort()
  return names.length === 0
    ? "^$"
    : `(?i)^(?:${names.map(escapeRegex).join("|")})[.]$`
}

export function coreDnsConfiguration(
  networking: RelayNetworking,
  hostnames: ReadonlyArray<string>
): string {
  const pattern = coreDnsHostnamePattern(networking.domain, hostnames)
  return `${networking.domain}:${networking.dnsPort} {\n    errors\n    template IN A {\n        match "${pattern}"\n        answer "{{ .Name }} 60 IN A {$KILN_NODE_ADDRESS}"\n    }\n    template IN AAAA {\n        match "${pattern}"\n        rcode NOERROR\n    }\n}\n`
}

export function tailscaleCoreDnsConfiguration(
  settings: RelayTailscaleSettings,
  address: string,
  hostnames: ReadonlyArray<string>
): string {
  const pattern = coreDnsHostnamePattern(settings.domain, hostnames)
  return `${settings.domain}:${settings.dnsPort} {\n    bind ${address}\n    errors\n    template IN A {\n        match "${pattern}"\n        answer "{{ .Name }} 60 IN A ${address}"\n    }\n    template IN AAAA {\n        match "${pattern}"\n        rcode NOERROR\n    }\n}\n`
}

export function tailscaleStackSubnet(stackId: string, nodeId: string): string {
  return allocateTailscaleStackSubnet(stackId, nodeId, new Set())
}

export function allocateTailscaleStackSubnet(
  stackId: string,
  nodeId: string,
  reserved: ReadonlySet<string>
): string {
  const digest = createHash("sha256").update(`${stackId}:${nodeId}`).digest()
  const start =
    (((digest[0] ?? 0) << 8) | (digest[1] ?? 0)) % TAILSCALE_STACK_SUBNET_COUNT
  const stepSeed = ((digest[2] ?? 0) << 8) | (digest[3] ?? 0)
  const step = (stepSeed % (TAILSCALE_STACK_SUBNET_COUNT / 2)) * 2 + 1
  for (let offset = 0; offset < TAILSCALE_STACK_SUBNET_COUNT; offset += 1) {
    const index = (start + offset * step) % TAILSCALE_STACK_SUBNET_COUNT
    const subnet = `10.${128 + Math.floor(index / 256)}.${index % 256}.0/24`
    if (!reserved.has(subnet)) return subnet
  }
  throw new Error("No private Tailscale subnets remain on this Relay")
}

export function tailscaleStackServiceAddress(subnet: string): string {
  const prefix = subnet.replace(/\.0\/24$/u, "")
  if (prefix === subnet) throw new Error(`Invalid Tailscale subnet ${subnet}`)
  return `${prefix}.2`
}

export function allocateTailscaleBindingAddress(
  subnet: string,
  reserved: Set<string>
): string {
  const prefix = subnet.replace(/\.0\/24$/u, "")
  if (prefix === subnet) throw new Error(`Invalid Tailscale subnet ${subnet}`)
  for (let host = 10; host <= 254; host += 1) {
    const address = `${prefix}.${host}`
    if (reserved.has(address)) continue
    reserved.add(address)
    return address
  }
  throw new Error(
    `Tailscale subnet ${subnet} has no available server addresses`
  )
}

export function assignTailscaleBindingAddresses(
  subnet: string,
  existing: ReadonlyArray<{
    address: string
    hostname: string
    instanceId: string
  }>,
  desired: ReadonlyArray<{ hostname: string; instanceId: string }>
): Array<{ address: string; hostname: string; instanceId: string }> {
  const desiredInstanceIds = new Set(
    desired.map(({ instanceId }) => instanceId)
  )
  const previousByInstance = new Map(
    existing.map((binding) => [binding.instanceId, binding])
  )
  const reserved = new Set(
    existing
      .filter(({ instanceId }) => desiredInstanceIds.has(instanceId))
      .map(({ address }) => address)
  )

  return desired.map((binding) => {
    const previous = previousByInstance.get(binding.instanceId)
    return {
      ...binding,
      address:
        previous?.address ?? allocateTailscaleBindingAddress(subnet, reserved),
    }
  })
}

export function tailscaleStackWithoutInstance(
  config: RelayTailscaleStackConfig,
  records: ReadonlyArray<{ address: string; hostname: string }>,
  instanceId: string
): {
  config: RelayTailscaleStackConfig
  records: Array<{ address: string; hostname: string }>
} {
  const removedAddresses = new Set(
    config.bindings
      .filter((binding) => binding.instanceId === instanceId)
      .map(({ address }) => address)
  )
  return {
    config: relayTailscaleStackConfigSchema.parse({
      ...config,
      bindings: config.bindings.filter(
        (binding) => binding.instanceId !== instanceId
      ),
    }),
    records: records.filter((record) => !removedAddresses.has(record.address)),
  }
}

export function tailscaleStackCoreDnsConfiguration(
  domain: string,
  records: ReadonlyArray<{ address: string; hostname: string }>
): string {
  const entries = [...records]
    .sort((left, right) => left.hostname.localeCompare(right.hostname))
    .map(
      ({ address, hostname }) =>
        `        ${address} ${hostname.replace(/\.$/u, "")}.${domain}`
    )
    .join("\n")
  return `${domain}:53 {\n    errors\n    cache 30\n    hosts {\n${entries}${entries ? "\n" : ""}        ttl 60\n    }\n}\n`
}

export function tailscaleStackCoreDnsRecords(
  domain: string,
  configuration: string
): Array<{ address: string; hostname: string }> {
  const suffix = `.${domain}`
  const records = configuration
    .split("\n")
    .map((line) => line.trim().split(/\s+/u))
    .flatMap(([address, name]) => {
      if (!address || !name || !name.endsWith(suffix)) return []
      return [
        {
          address,
          hostname: name.slice(0, -suffix.length),
        },
      ]
    })
  return relayTailscaleStackDnsSchema.parse({
    id: "0".repeat(40),
    records,
  }).records
}
