import { createHash, randomBytes } from "node:crypto"
import { chmod, chown, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { interpolateTemplate, resolveBrick } from "./bricks.js"
import { command } from "./command.js"
import type {
  RelayCreateInstance,
  RelayInstance,
  RelayInstanceWebRoute,
  RelayInstanceWebRouteState,
  RelayNetworking,
  RelayProxyDiagnostics,
  RelayProxySettings,
  RelayUpdateInstanceStartup,
} from "@workspace/contracts"
import { relayProxySettingsSchema } from "@workspace/contracts"
import type { BrickCatalog } from "./bricks.js"
import type { RelayConfig, RelayInstanceConfig } from "./config.js"
import type { DockerDriver } from "./docker.js"
import type { RelayStoredWebRoute } from "./effect/state.js"

const GAME_NETWORK_NAME = "kiln-minecraft"
const EDGE_NETWORK_NAME = "kiln-edge"
const RELAY_EDGE_NETWORK_NAME = "kiln-relay-edge"
const RELAY_EDGE_ALIAS = "kiln-relay"
const WEB_ROUTE_REVISION_LABEL = "kiln.relay.web-routes.revision"
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
  #edgeMutation: Promise<void> = Promise.resolve()
  #edgeReconciliationPending = false
  #edgeReconciliationTimer: NodeJS.Timeout | null = null
  #hostDataDirectoryPromise: Promise<string> | null = null
  #listenerMode: RelayProxySettings["mode"] | null = null
  #webRoutes: ReadonlyArray<RelayStoredWebRoute> = []

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
      (binding) =>
        binding.HostIp !== "127.0.0.1" && binding.HostIp !== "::1"
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
          (owner) => owner !== TRAEFIK_CONTAINER
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
      TRAEFIK_CONTAINER,
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
        `Manual edge mode does not modify an external proxy. Attach it to ${EDGE_NETWORK_NAME} before publishing Ember routes.`
      )
    }
    let coolifyReady = false
    if (settings.mode === "coolify") {
      if (!coolifyProxy) {
        warnings.push(
          "Coolify mode could not find a running coolify-proxy container. Confirm this Relay is on a Coolify host using its Traefik proxy."
        )
      } else if (!(await containerUsesNetwork(coolifyProxy, EDGE_NETWORK_NAME))) {
        warnings.push(
          `Coolify Traefik is not attached to ${EDGE_NETWORK_NAME}. Relay will keep retrying the private edge attachment.`
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
      await this.#serializeEdgeMutation(() => this.#disableExternalEdge())
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
        message: "Bundled Traefik applies this route dynamically.",
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
    const desiredLabels = traefikRouteLabels(routes, profile)
    const labels = await containerLabels(instance.service)
    const requiresRestart = routeLabelsRequireRestart(
      labels,
      routes,
      desiredLabels
    )
    const edgeConnected = await containerUsesNetwork(
      instance.service,
      EDGE_NETWORK_NAME
    )
    const proxy = await this.#externalTraefikContainer(settings)
    const proxyConnected = Boolean(
      proxy && (await containerUsesNetwork(proxy, EDGE_NETWORK_NAME))
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
          ? `Relay found ${proxy}, but the ${EDGE_NETWORK_NAME} attachment is not ready yet.`
          : settings.mode === "coolify"
            ? "Relay could not find Coolify's running coolify-proxy container."
            : `Attach your Traefik container to ${EDGE_NETWORK_NAME} to activate this route.`,
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
    routes: ReadonlyArray<RelayInstanceWebRoute>
  ): Promise<RelayInstance> {
    const settings = await this.proxySettings()
    if (
      (settings.mode === "none" || settings.mode === "coolify") &&
      instance.managedByRelay &&
      (action === "start" || action === "restart")
    ) {
      const profile = this.#externalTraefikProfile(settings)
      const desiredLabels = traefikRouteLabels(routes, profile)
      const labels = await containerLabels(instance.service)
      if (routeLabelsRequireRestart(labels, routes, desiredLabels)) {
        await this.#ensureEdgeNetwork()
        return this.#docker.recreateOwnedInstance(
          instance,
          desiredLabels,
          routes.length > 0 ? EDGE_NETWORK_NAME : null
        )
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

  async createInstance(input: RelayCreateInstance): Promise<RelayInstance> {
    const id = randomBytes(32).toString("hex").slice(0, 40)
    return this.#provisionManagedInstance({
      id,
      prepareDirectory: true,
      recipe: input.recipe,
      start: input.start,
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
    const recipe = input.recipe ?? existing.brickSource
    if (!recipe) {
      throw new Error("Instance is missing its Brick recipe source")
    }

    await command("docker", ["stop", "--time", "30", existing.service], {
      timeout: 45_000,
    }).catch(() => undefined)
    await command("docker", ["rm", "--force", existing.service], {
      timeout: 90_000,
    })

    try {
      return await this.#provisionManagedInstance({
        id: existing.id,
        prepareDirectory: false,
        recipe,
        start: input.start,
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
    id: string
    prepareDirectory: boolean
    recipe: string
    start: boolean
    variables: RelayCreateInstance["variables"]
  }): Promise<RelayInstance> {
    const definition = await this.#bricks.recipe(input.recipe)
    const resolved = resolveBrick(definition, input.variables, input.recipe)
    const existing = await this.#docker.inspectInstances()
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

    const variablesLabel = JSON.stringify(resolved.values)
    const arguments_ = [
      "container",
      "create",
      "--name",
      containerName,
      "--hostname",
      containerName,
      "--network",
      GAME_NETWORK_NAME,
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
      `kiln.brick.primary-port=${primaryPort.container}`,
      "--label",
      "kiln.traefik.managed=true",
      "--label",
      `kiln.traefik.service.port=${primaryPort.container}`,
      "--label",
      `traefik.docker.network=${EDGE_NETWORK_NAME}`,
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
      if (input.prepareDirectory) {
        await rm(directory, { recursive: true, force: true })
      }
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
      await command("docker", ["network", "inspect", GAME_NETWORK_NAME])
    } catch {
      await command("docker", ["network", "create", GAME_NETWORK_NAME])
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
      GAME_NETWORK_NAME,
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
      GAME_NETWORK_NAME,
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
      RELAY_EDGE_NETWORK_NAME,
      RELAY_EDGE_ALIAS
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
      RELAY_EDGE_NETWORK_NAME,
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
      await this.#ensureContainer(TRAEFIK_CONTAINER, replace, arguments_)
      await connectNetwork(TRAEFIK_CONTAINER, RELAY_EDGE_NETWORK_NAME)
      await connectNetwork(TRAEFIK_CONTAINER, GAME_NETWORK_NAME)
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
    await this.#ensureEdgeNetwork()
    if (settings.mode === "coolify") {
      const proxy = await this.#externalTraefikContainer(settings)
      if (proxy) await connectNetwork(proxy, EDGE_NETWORK_NAME)
    }

    const routedInstances = new Set(routes.map((route) => route.instanceId))
    const instances = await this.#docker.inspectInstances()
    await Promise.all(
      instances
        .filter((instance) => instance.managedByRelay)
        .map((instance) =>
          routedInstances.has(instance.id)
            ? connectNetwork(instance.service, EDGE_NETWORK_NAME)
            : disconnectNetwork(instance.service, EDGE_NETWORK_NAME)
        )
    )
  }

  async #removeBundledTraefik(): Promise<void> {
    await command("docker", ["rm", "--force", TRAEFIK_CONTAINER]).catch(
      () => undefined
    )
    const relayContainer = process.env.HOSTNAME?.trim()
    if (relayContainer) {
      await disconnectNetwork(relayContainer, RELAY_EDGE_NETWORK_NAME)
    }
    await command("docker", ["network", "rm", RELAY_EDGE_NETWORK_NAME]).catch(
      () => undefined
    )
  }

  async #ensureEdgeNetwork(): Promise<void> {
    const inspected = await command("docker", [
      "network",
      "inspect",
      "--format",
      '{{index .Labels "kiln.relay.network"}}',
      EDGE_NETWORK_NAME,
    ]).catch(() => null)
    if (inspected) {
      if (inspected.stdout.trim() === "edge") return
      throw new Error(
        `Docker network ${EDGE_NETWORK_NAME} already exists but is not owned by this Relay. Rename or remove that network before enabling Ember web routes.`
      )
    }
    await command("docker", [
      "network",
      "create",
      "--label",
      "kiln.relay.network=edge",
      EDGE_NETWORK_NAME,
    ])
  }

  async #ensureRelayEdgeNetwork(): Promise<void> {
    const inspected = await command("docker", [
      "network",
      "inspect",
      "--format",
      '{{index .Labels "kiln.relay.network"}}',
      RELAY_EDGE_NETWORK_NAME,
    ]).catch(() => null)
    if (inspected) {
      if (inspected.stdout.trim() === "relay-edge") return
      throw new Error(
        `Docker network ${RELAY_EDGE_NETWORK_NAME} already exists but is not owned by this Relay.`
      )
    }
    await command("docker", [
      "network",
      "create",
      "--label",
      "kiln.relay.network=relay-edge",
      RELAY_EDGE_NETWORK_NAME,
    ])
  }

  async #externalTraefikContainer(
    settings?: RelayProxySettings
  ): Promise<string | null> {
    if (settings?.mode === "coolify") {
      return firstTraefikContainer(["coolify-proxy"])
    }
    const candidates = ["coolify-proxy"]
    const ports = await Promise.all(
      [80, 443].map((port) =>
        command("docker", [
          "ps",
          "--filter",
          `publish=${port}`,
          "--format",
          "{{.Names}}",
        ]).catch(() => ({ stderr: "", stdout: "" }))
      )
    )
    for (const result of ports) {
      candidates.push(
        ...result.stdout
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean)
      )
    }
    return firstTraefikContainer(Array.from(new Set(candidates)))
  }

  #externalTraefikProfile(
    settings: RelayProxySettings
  ): TraefikLabelProfile {
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

  async #disableExternalEdge(): Promise<void> {
    const instances = await this.#docker.inspectInstances()
    const proxy = await this.#externalTraefikContainer()
    await Promise.all([
      ...instances
        .filter((instance) => instance.managedByRelay)
        .map((instance) =>
          disconnectNetwork(instance.service, EDGE_NETWORK_NAME)
        ),
      ...(proxy ? [disconnectNetwork(proxy, EDGE_NETWORK_NAME)] : []),
    ])
    await command("docker", ["network", "rm", EDGE_NETWORK_NAME]).catch(
      () => undefined
    )
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
    const inspected = await command("docker", [
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
    .then((result) => {
      const labels = JSON.parse(result.stdout) as unknown
      if (!labels || typeof labels !== "object" || Array.isArray(labels))
        return {}
      return Object.fromEntries(
        Object.entries(labels).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      )
    })
    .catch(() => ({}))
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
  profile: TraefikLabelProfile
): Record<string, string> {
  const labels: Record<string, string> = {
    "traefik.enable": routes.length > 0 ? "true" : "false",
  }
  if (routes.length > 0) labels["traefik.docker.network"] = EDGE_NETWORK_NAME

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

  const revision = createHash("sha256")
    .update(
      JSON.stringify(
        Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
      )
    )
    .digest("hex")
  labels[WEB_ROUTE_REVISION_LABEL] = revision
  return labels
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
    Object.keys(current).some((label) => label.startsWith("traefik.http."))
  return (
    hasManagedRouteLabels &&
    current[WEB_ROUTE_REVISION_LABEL] !== desired[WEB_ROUTE_REVISION_LABEL]
  )
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
    lines.push(
      "    kiln-relay:",
      "      loadBalancer:",
      "        servers:",
      `          - url: ${JSON.stringify(`http://${RELAY_EDGE_ALIAS}:${config.port}`)}`
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
