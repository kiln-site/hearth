import { randomBytes } from "node:crypto"
import { chown, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { brick } from "./bricks.js"
import { command } from "./command.js"
import type {
  BrickId,
  RelayCreateInstance,
  RelayInstance,
  RelayNetworking,
} from "@workspace/contracts"
import type { RelayConfig } from "./config.js"
import type { DockerDriver } from "./docker.js"

const NETWORK_NAME = "kiln-minecraft"
const OWNED_LABEL = "kiln.relay.owned=true"
interface BackendRoute {
  hostname: string
  implementation: BrickId
  name: string
  target: string
  version: string
}

export class LifecycleDriver {
  readonly #config: RelayConfig
  readonly #docker: DockerDriver
  #hostDataDirectoryPromise: Promise<string> | null = null

  constructor(config: RelayConfig, docker: DockerDriver) {
    this.#config = config
    this.#docker = docker
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

  async createInstance(input: RelayCreateInstance): Promise<RelayInstance> {
    const definition = brick(input.brickId)
    const existing = await this.#docker.inspectInstances()
    if (
      input.brickId === "velocity" &&
      existing.some(
        (instance) => instance.managedByRelay && instance.brickId === "velocity"
      )
    ) {
      throw new Error("This Relay already has a Velocity entrypoint")
    }
    if (
      input.brickId === "palworld" &&
      existing.some(
        (instance) => instance.managedByRelay && instance.brickId === "palworld"
      )
    ) {
      throw new Error("This Relay already has a Palworld server on UDP 8211")
    }
    if (input.brickId === "palworld" && input.version !== "latest") {
      throw new Error("Palworld currently supports the latest Steam build only")
    }
    if (input.brickId === "palworld" && process.arch !== "x64") {
      throw new Error("Palworld's dedicated server requires an amd64 Relay")
    }

    const id = randomBytes(32).toString("hex").slice(0, 40)
    const shortId = id.slice(0, 8)
    const containerName = `kiln-${shortId}`
    const javaVersion =
      input.brickId === "palworld"
        ? definition.javaVersion
        : javaVersionFor(input.brickId, input.version)
    const image =
      input.brickId === "palworld"
        ? definition.image
        : `ghcr.io/kiln-site/ember:java${javaVersion}`
    const memoryLimit = containerMemoryLimit(input.memory)
    const directory = join(this.#config.rootDirectory, id)
    const hostDirectory = join(await this.#hostDataDirectory(), "instances", id)
    const networking = await this.networking()
    const hostname =
      input.brickId === "palworld"
        ? `palworld.${networking?.domain ?? this.#config.connectDomain}`
        : definition.proxy
          ? `velocity.${networking?.domain ?? this.#config.connectDomain}`
          : `${input.version}.${input.brickId}.${networking?.domain ?? this.#config.connectDomain}`
    const connectPort =
      input.brickId === "palworld"
        ? 8211
        : definition.proxy
          ? (networking?.proxyPort ?? this.#config.connectPort)
          : this.#config.connectPort
    const connectAddress =
      connectPort === 25_565 ? hostname : `${hostname}:${connectPort}`

    await mkdir(directory, { recursive: true })
    if (input.brickId === "palworld") {
      await chown(directory, 1000, 1000)
    }
    await this.#ensureNetwork()
    if (networking?.enabled) await this.#ensureInfrastructure(networking, false)
    try {
      await command("docker", ["image", "inspect", image])
    } catch {
      await command("docker", ["pull", image], { timeout: 300_000 })
    }

    if (definition.proxy) {
      await this.#writeVelocityConfig(
        directory,
        networking,
        this.#backendRoutes(existing)
      )
    }

    const arguments_ = [
      "container",
      "create",
      "--name",
      containerName,
      "--hostname",
      containerName,
      "--network",
      NETWORK_NAME,
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
      "512",
      "--memory-reservation",
      input.memory,
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
      `kiln.brick.id=${input.brickId}`,
      "--label",
      `kiln.instance.name=${containerName}`,
      "--label",
      `kiln.instance.version=${input.version}`,
      "--label",
      `kiln.instance.java=${javaVersion}`,
      "--label",
      `kiln.instance.game=${input.brickId === "palworld" ? "Palworld" : "Minecraft"}`,
      "--label",
      `kiln.instance.hostname=${connectAddress}`,
      "--label",
      `kiln.instance.directory=${id}`,
      "--volume",
      `${hostDirectory}:/server`,
      "--env",
      `KILN_IMPLEMENTATION=${input.brickId}`,
      "--env",
      `KILN_VERSION=${input.version}`,
    ]

    if (input.brickId === "palworld") {
      arguments_.push("--publish", "8211:8211/udp")
    } else {
      arguments_.push(
        "--env",
        `KILN_ARTIFACT_URL=${artifactUrl(input.brickId, input.version)}`,
        "--env",
        `KILN_ARTIFACT_FILE=${artifactFile(input.brickId)}`,
        "--env",
        "MIN_RAM=512M",
        "--env",
        `MAX_RAM=${input.memory}`
      )
    }

    if (definition.proxy) {
      arguments_.push(
        "--publish",
        `${networking?.proxyPort ?? 25_565}:25565`,
        "--env",
        "KILN_SERVER_ARGS="
      )
    }
    arguments_.push(image)

    try {
      await command("docker", arguments_, { timeout: 60_000 })
      if (input.start) {
        await command("docker", ["start", containerName], { timeout: 120_000 })
      }
      if (!definition.proxy && input.brickId !== "palworld")
        await this.#refreshVelocityConfigurations(networking)
    } catch (error) {
      await command("docker", ["rm", "--force", containerName]).catch(
        () => undefined
      )
      await rm(directory, { recursive: true, force: true })
      throw error
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

  async deleteInstance(id: string, deleteData: boolean): Promise<void> {
    const instance = await this.#docker.findInstance(id)
    if (!instance) throw new Error("Instance not found")
    if (!instance.managedByRelay) {
      throw new Error("Relay can only delete containers it created")
    }
    await command("docker", ["stop", "--time", "30", instance.service], {
      timeout: 45_000,
    }).catch(() => undefined)
    await command("docker", ["rm", "--force", instance.service], {
      timeout: 90_000,
    })
    if (deleteData) {
      await rm(join(this.#config.rootDirectory, instance.directory), {
        recursive: true,
        force: true,
      })
    }
    if (instance.brickId !== "palworld") {
      await this.#refreshVelocityConfigurations(await this.networking())
    }
  }

  async #ensureNetwork(): Promise<void> {
    try {
      await command("docker", ["network", "inspect", NETWORK_NAME])
    } catch {
      await command("docker", ["network", "create", NETWORK_NAME])
    }
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
    await writeFile(
      join(coreDns, "Corefile"),
      `${networking.domain}:${networking.dnsPort} {\n    errors\n    template IN A {\n        match "^([a-z0-9-]+[.])*(paper|fabric|folia|velocity)[.]${escapeRegex(networking.domain)}[.]$"\n        answer "{{ .Name }} 60 IN A {$KILN_NODE_ADDRESS}"\n    }\n    template IN AAAA {\n        match "^([a-z0-9-]+[.])*(paper|fabric|folia|velocity)[.]${escapeRegex(networking.domain)}[.]$"\n        rcode NOERROR\n    }\n}\n`
    )
    await writeFile(
      join(limbo, "server.toml"),
      `bind = "0.0.0.0:25565"\nwelcome_message = "<aqua>Starting your Kiln instance…</aqua>"\naction_bar = "<gray>The requested backend is not ready yet.</gray>"\ndefault_game_mode = "spectator"\nfetch_player_skins = false\n\n[forwarding]\nmethod = "NONE"\nsecret = "unused"\n\n[server_list]\nreply_to_status = true\nmax_players = 20\nmessage_of_the_day = "<aqua>Kiln standby</aqua>"\n`
    )

    await this.#ensureContainer("kiln-coredns", replace, [
      "--network",
      NETWORK_NAME,
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
    await this.#ensureContainer("kiln-limbo", replace, [
      "--network",
      NETWORK_NAME,
      "--network-alias",
      "limbo",
      "--restart",
      "unless-stopped",
      "--volume",
      `${join(hostInfrastructure, "limbo", "server.toml")}:/usr/src/app/server.toml:ro`,
      "ghcr.io/quozul/picolimbo:v1.13.1-mc26.2",
    ])
  }

  async #removeInfrastructure(): Promise<void> {
    await Promise.all(
      ["kiln-coredns", "kiln-limbo"].map((name) =>
        command("docker", ["rm", "--force", name]).catch(() => undefined)
      )
    )
  }

  async #replaceContainer(
    name: string,
    arguments_: Array<string>
  ): Promise<void> {
    await command("docker", ["rm", "--force", name]).catch(() => undefined)
    await command(
      "docker",
      ["run", "--detach", "--name", name, ...arguments_],
      {
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
      try {
        await command("docker", ["container", "inspect", name])
        return
      } catch {
        // The configured infrastructure container does not exist yet.
      }
    }
    await this.#replaceContainer(name, arguments_)
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
      (instance) => instance.managedByRelay && instance.brickId === "velocity"
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
          instance.brickId !== "velocity" &&
          instance.brickId !== "palworld" &&
          Boolean(instance.brickId)
      )
      .map((instance) => ({
        hostname: instance.connectAddress.split(":")[0] ?? instance.name,
        implementation: instance.brickId as BrickId,
        name: instance.name,
        target: `${instance.service}:25565`,
        version: instance.version,
      }))
  }

  async #writeVelocityConfig(
    directory: string,
    networking: RelayNetworking | null,
    routes: Array<BackendRoute>
  ): Promise<void> {
    const domain = networking?.domain ?? this.#config.connectDomain
    const byImplementation = new Map<BrickId, Array<string>>()
    for (const route of routes) {
      const current = byImplementation.get(route.implementation) ?? []
      current.push(route.name)
      byImplementation.set(route.implementation, current)
    }
    const servers = [
      ...routes.map((route) => `"${route.name}" = "${route.target}"`),
      '"limbo" = "limbo:25565"',
    ].join("\n")
    const forcedHosts = [
      ...routes.map(
        (route) => `"${route.hostname}" = ["${route.name}", "limbo"]`
      ),
      ...Array.from(
        byImplementation,
        ([implementation, names]) =>
          `"${implementation}.${domain}" = [${names.map((name) => `"${name}"`).join(", ")}, "limbo"]`
      ),
    ].join("\n")
    await writeFile(
      join(directory, "velocity.toml"),
      `config-version = "2.8"\nbind = "0.0.0.0:25565"\nmotd = "<#f97316>Kiln managed network"\nshow-max-players = 500\nonline-mode = true\nforce-key-authentication = true\nplayer-info-forwarding-mode = "none"\nannounce-forge = false\nping-passthrough = "DISABLED"\nenable-player-address-logging = true\n\n[servers]\n${servers}\ntry = ["limbo"]\n\n[forced-hosts]\n${forcedHosts}\n\n[advanced]\ncompression-threshold = 256\ncompression-level = -1\nlogin-ratelimit = 3000\nconnection-timeout = 5000\nread-timeout = 30000\n\n[query]\nenabled = false\nport = 25565\nmap = "Kiln"\nshow-plugins = false\n`
    )
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

function javaVersionFor(brickId: BrickId, version: string): "21" | "25" {
  if (brickId === "velocity") return version.startsWith("4.") ? "25" : "21"
  return /^2[6-9](?:\.|$)/u.test(version) ? "25" : "21"
}

function containerMemoryLimit(heap: string): string {
  const value = Number.parseInt(heap.slice(0, -1), 10)
  const unit = heap.at(-1)
  const heapMiB = unit === "G" ? value * 1024 : value
  const nativeHeadroomMiB = Math.max(512, Math.ceil(heapMiB * 0.25))
  return `${heapMiB + nativeHeadroomMiB}M`
}

function artifactUrl(brickId: BrickId, version: string): string {
  const type =
    brickId === "fabric"
      ? "modded"
      : brickId === "velocity"
        ? "proxies"
        : "servers"
  if (version === "latest") {
    return `https://mcjarfiles.com/api/get-latest-jar/${type}/${brickId}`
  }
  return `https://mcjarfiles.com/api/get-jar/${type}/${brickId}/${encodeURIComponent(version)}`
}

function artifactFile(brickId: BrickId): string {
  if (brickId === "fabric") return "fabric-server-launcher.jar"
  return `${brickId}.jar`
}
