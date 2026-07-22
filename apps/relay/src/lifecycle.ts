import { randomBytes } from "node:crypto"
import { chmod, chown, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { interpolateTemplate, resolveBrick } from "./bricks.js"
import { command } from "./command.js"
import type {
  RelayCreateInstance,
  RelayInstance,
  RelayNetworking,
  RelayProxyDiagnostics,
  RelayProxySettings,
} from "@workspace/contracts"
import { relayProxySettingsSchema } from "@workspace/contracts"
import type { BrickCatalog } from "./bricks.js"
import type { RelayConfig } from "./config.js"
import type { DockerDriver } from "./docker.js"
import type { RelayStoredWebRoute } from "./effect/state.js"

const NETWORK_NAME = "kiln-minecraft"
const OWNED_LABEL = "kiln.relay.owned=true"
const TRAEFIK_CONTAINER = "kiln-traefik"
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
  #hostDataDirectoryPromise: Promise<string> | null = null

  constructor(config: RelayConfig, docker: DockerDriver, bricks: BrickCatalog) {
    this.#bricks = bricks
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
    await this.#writeProxySettings(settings)
    this.hydrateProxySettings(settings)
    await this.configureWebRoutes(routes, settings)
    if (settings.mode === "traefik") {
      const diagnostics = await this.proxyDiagnostics(settings)
      if (diagnostics.status !== "blocked") {
        await this.#ensureTraefik(settings, routes, true)
      }
    } else {
      await command("docker", ["rm", "--force", TRAEFIK_CONTAINER]).catch(
        () => undefined
      )
    }
    return { diagnostics: await this.proxyDiagnostics(settings), settings }
  }

  async initializeProxy(
    routes: ReadonlyArray<RelayStoredWebRoute>,
    configuredSettings?: RelayProxySettings
  ): Promise<void> {
    const settings = configuredSettings ?? (await this.proxySettings())
    this.hydrateProxySettings(settings)
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
    }
  }

  hydrateProxySettings(settings: RelayProxySettings): void {
    this.#config.proxyMode = settings.mode
    this.#config.traefikImage = settings.traefikImage
    this.#config.traefikAcmeEmail = settings.acmeEmail
    if (settings.mode === "traefik") {
      this.#config.publicPort = 443
      this.#config.browserOrigin = `https://${formatPublicHost(this.#config.advertisedHost)}`
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
          (owner) => owner !== TRAEFIK_CONTAINER
        )
        return {
          available: !conflictingOwner,
          owner: conflictingOwner ?? owners[0] ?? null,
          port,
        }
      })
    )
    const containerRunning = await command("docker", [
      "inspect",
      "--format",
      "{{.State.Running}}",
      TRAEFIK_CONTAINER,
    ])
      .then((result) => result.stdout.trim() === "true")
      .catch(() => false)
    const conflicts = ports.filter((port) => !port.available)
    const warnings: Array<string> = []
    if (conflicts.length > 0) {
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
      const owners = Array.from(
        new Set(ports.flatMap((port) => (port.owner ? [port.owner] : [])))
      )
      const existingTraefik = await firstTraefikContainer(owners)
      if (!existingTraefik) {
        warnings.push(
          "No existing Traefik listener was detected on ports 80 or 443. Public routes require manual edge configuration."
        )
      } else if (!(await containerUsesNetwork(existingTraefik, NETWORK_NAME))) {
        warnings.push(
          `Existing Traefik ${existingTraefik} cannot reach route carriers yet. Attach it with: docker network connect ${NETWORK_NAME} ${existingTraefik}`
        )
      }
    }
    return {
      containerRunning,
      mode: settings.mode,
      ports,
      publicReachability: "unknown",
      status:
        settings.mode === "none"
          ? "disabled"
          : settings.mode === "hearth"
            ? "hearth"
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
    if (settings.mode === "none") {
      await this.#reconcileExternalTraefikRoutes(routes)
    } else {
      await this.#removeExternalTraefikRoutes()
    }
  }

  async #writeProxySettings(settings: RelayProxySettings): Promise<void> {
    await mkdir(this.#config.dataDirectory, { recursive: true })
    await writeFile(
      join(this.#config.dataDirectory, "proxy.json"),
      `${JSON.stringify(settings, null, 2)}\n`,
      { mode: 0o600 }
    )
  }

  async createInstance(input: RelayCreateInstance): Promise<RelayInstance> {
    const definition = await this.#bricks.recipe(input.recipe)
    const resolved = resolveBrick(definition, input.variables, input.recipe)
    const existing = await this.#docker.inspectInstances()
    if (
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

    const id = randomBytes(32).toString("hex").slice(0, 40)
    const shortId = id.slice(0, 8)
    const containerName = `kiln-${shortId}`
    const version = Object.hasOwn(resolved.values, "version")
      ? String(resolved.values.version)
      : "custom"
    const image = definition.runtime.image
    const memoryLimit = resolved.memory
    const directory = join(this.#config.rootDirectory, id)
    const hostDirectory = join(await this.#hostDataDirectory(), "instances", id)
    const networking = await this.networking()
    const domain = networking?.domain ?? this.#config.connectDomain
    const hostnamePrefix = interpolateTemplate(
      definition.network.hostname ?? "{{ brick.id }}",
      definition,
      resolved.values,
      input.recipe
    )
    const hostname = `${hostnamePrefix.replace(/\.$/u, "")}.${domain}`
    const primaryPort = definition.network.ports.find(
      (port) => port.name === definition.network.primaryPort
    )
    if (!primaryPort) {
      throw new Error("Brick primary network port disappeared after validation")
    }
    const connectPort =
      definition.network.mode === "minecraft-proxy"
        ? (networking?.proxyPort ?? this.#config.connectPort)
        : definition.network.mode === "direct"
          ? (primaryPort.host ?? primaryPort.container)
          : this.#config.connectPort
    const connectAddress =
      connectPort === 25_565 ? hostname : `${hostname}:${connectPort}`

    await mkdir(directory, { recursive: true })
    if (definition.runtime.user) {
      const identity = definition.runtime.user.split(":")
      const user = Number(identity[0])
      const group = identity.length === 2 ? Number(identity[1]) : user
      await chown(directory, user, group)
    }
    await this.#ensureNetwork()
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
      `kiln.brick.network-mode=${definition.network.mode}`,
      "--label",
      `kiln.brick.primary-port=${primaryPort.container}`,
      "--label",
      "kiln.traefik.managed=true",
      "--label",
      `kiln.traefik.service.port=${primaryPort.container}`,
      "--label",
      "traefik.docker.network=kiln-minecraft",
      "--label",
      "traefik.enable=false",
      "--label",
      `kiln.instance.name=${containerName}`,
      "--label",
      `kiln.instance.version=${version}`,
      "--label",
      `kiln.instance.java=${definition.runtime.name}`,
      "--label",
      `kiln.instance.game=${definition.metadata.game}`,
      "--label",
      `kiln.instance.hostname=${connectAddress}`,
      "--label",
      `kiln.instance.directory=${id}`,
      "--label",
      `kiln.instance.mount=${definition.runtime.storage.mount}`,
      "--volume",
      `${hostDirectory}:${definition.runtime.storage.mount}`,
    ]

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
    if (definition.network.mode === "minecraft-proxy") {
      arguments_.push(
        "--publish",
        `${networking?.proxyPort ?? 25_565}:${primaryPort.container}/${primaryPort.protocol}`
      )
    }
    if (definition.network.mode === "direct") {
      for (const port of definition.network.ports) {
        arguments_.push(
          "--publish",
          `${port.host ?? port.container}:${port.container}/${port.protocol}`
        )
      }
    }
    arguments_.push(image)
    arguments_.push(...(definition.runtime.entrypoint?.slice(1) ?? []))
    arguments_.push(...(definition.runtime.command ?? []))

    try {
      await command("docker", arguments_, { timeout: 60_000 })
      if (input.start) {
        await command("docker", ["start", containerName], { timeout: 120_000 })
      }
      if (networking?.enabled)
        await this.#refreshCoreDnsConfiguration(networking)
      if (definition.network.mode === "minecraft-backend")
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
    const networking = await this.networking()
    if (networking?.enabled) await this.#refreshCoreDnsConfiguration(networking)
    if (instance.brickNetworkMode === "minecraft-backend")
      await this.#refreshVelocityConfigurations(networking)
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
      NETWORK_NAME,
      "--restart",
      "unless-stopped",
      "--label",
      "kiln.relay.infrastructure=traefik",
      "--publish",
      "80:80",
      "--publish",
      "443:443",
      "--add-host",
      "host.docker.internal:host-gateway",
      "--volume",
      `${join(hostInfrastructure, "traefik.yaml")}:/etc/traefik/traefik.yaml:ro`,
      "--volume",
      `${join(hostInfrastructure, "dynamic")}:/etc/traefik/dynamic:ro`,
      "--volume",
      `${join(hostInfrastructure, "state")}:/var/lib/traefik`,
    ]
    if (this.#config.tlsMode === "managed") {
      arguments_.push(
        "--volume",
        `${join(await this.#hostDataDirectory(), "network", "tls", "ca.crt")}:/etc/traefik/relay-ca.crt:ro`
      )
    }
    arguments_.push(settings.traefikImage)
    try {
      await this.#ensureContainer(TRAEFIK_CONTAINER, replace, arguments_)
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
    routes: ReadonlyArray<RelayStoredWebRoute>
  ): Promise<void> {
    await this.#removeExternalTraefikRoutes()
    if (routes.length === 0) return
    await this.#ensureNetwork()
    const directory = join(
      this.#config.dataDirectory,
      "infrastructure",
      "traefik",
      "labels"
    )
    const hostDirectory = join(
      await this.#hostDataDirectory(),
      "infrastructure",
      "traefik",
      "labels"
    )
    await mkdir(directory, { recursive: true, mode: 0o700 })

    for (const route of routes) {
      const name = traefikRouteName(route.id)
      const routeDirectory = join(directory, route.id)
      await mkdir(routeDirectory, { recursive: true, mode: 0o700 })
      await writeFile(
        join(routeDirectory, "default.conf"),
        nginxRouteConfiguration(route),
        { mode: 0o600 }
      )
      const rule = route.path
        ? `Host(\`${route.hostname}\`) && PathPrefix(\`${route.path}\`)`
        : `Host(\`${route.hostname}\`)`
      const arguments_ = [
        "--network",
        NETWORK_NAME,
        "--restart",
        "unless-stopped",
        "--label",
        "kiln.relay.web-route=true",
        "--label",
        `kiln.relay.web-route-id=${route.id}`,
        "--label",
        "traefik.enable=true",
        "--label",
        `traefik.docker.network=${NETWORK_NAME}`,
        "--label",
        `traefik.http.routers.${name}.rule=${rule}`,
        "--label",
        `traefik.http.routers.${name}.priority=${route.path ? 100 + route.path.length : 10}`,
        "--label",
        `traefik.http.routers.${name}.entrypoints=websecure`,
        "--label",
        `traefik.http.routers.${name}.service=${name}`,
        "--label",
        `traefik.http.routers.${name}.tls=true`,
        "--label",
        `traefik.http.routers.${name}.tls.certresolver=kiln`,
        "--label",
        `traefik.http.services.${name}.loadbalancer.server.port=8080`,
        "--volume",
        `${join(hostDirectory, route.id, "default.conf")}:/etc/nginx/conf.d/default.conf:ro`,
      ]
      if (route.path && route.stripPrefix) {
        arguments_.push(
          "--label",
          `traefik.http.routers.${name}.middlewares=${name}-strip`,
          "--label",
          `traefik.http.middlewares.${name}-strip.stripprefix.prefixes=${route.path}`
        )
      }
      arguments_.push("nginx:1.29.1-alpine")
      await this.#replaceContainer(name, arguments_)
    }
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
      .filter((name) => name.startsWith("kiln-route-"))
    await Promise.all(
      names.map((name) =>
        command("docker", ["rm", "--force", name]).catch(() => undefined)
      )
    )
  }

  async #removeInfrastructure(): Promise<void> {
    await Promise.all(
      ["kiln-coredns", "kiln-limbo"].map((name) =>
        command("docker", ["rm", "--force", name]).catch(() => undefined)
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
    await command("docker", ["restart", "kiln-coredns"], { timeout: 90_000 })
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
    const domain = networking?.domain ?? this.#config.connectDomain
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

async function firstTraefikContainer(
  names: ReadonlyArray<string>
): Promise<string | null> {
  for (const name of names) {
    const image = await command("docker", [
      "inspect",
      "--format",
      "{{.Config.Image}}",
      name,
    ])
      .then((result) => result.stdout.trim().toLowerCase())
      .catch(() => "")
    if (image.startsWith("traefik:") || image.startsWith("traefik@")) {
      return name
    }
  }
  return null
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
    const relayScheme = config.tlsMode === "development" ? "http" : "https"
    lines.push(
      "    kiln-relay:",
      "      loadBalancer:",
      "        serversTransport: kiln-relay",
      "        servers:",
      `          - url: ${JSON.stringify(`${relayScheme}://host.docker.internal:${config.port}`)}`
    )
  }
  for (const route of routes) {
    const name = traefikRouteName(route.id)
    lines.push(
      `    ${name}:`,
      "      loadBalancer:",
      "        servers:",
      `          - url: ${JSON.stringify(`http://kiln-${route.instanceId.slice(0, 8)}:${route.targetPort}`)}`
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
  lines.push("  serversTransports:", "    kiln-relay:")
  if (config.tlsMode === "managed") {
    lines.push(
      `      serverName: ${JSON.stringify(config.advertisedHost)}`,
      "      rootCAs:",
      "        - /etc/traefik/relay-ca.crt"
    )
  } else if (config.tlsMode === "external") {
    lines.push(`      serverName: ${JSON.stringify(config.advertisedHost)}`)
  } else {
    lines.push("      insecureSkipVerify: false")
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

export function nginxRouteConfiguration(route: RelayStoredWebRoute): string {
  const target = `kiln-${route.instanceId.slice(0, 8)}:${route.targetPort}`
  return `server {
    listen 8080;
    server_name _;
    resolver 127.0.0.11 valid=10s ipv6=off;

    location / {
        set $kiln_upstream "${target}";
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass http://$kiln_upstream;
    }
}
`
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
