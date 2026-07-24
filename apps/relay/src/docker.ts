import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { statfs } from "node:fs/promises"
import { request } from "node:http"
import { hostname } from "node:os"
import { basename, relative, resolve } from "node:path"

import { command } from "./command.js"
import type {
  BrickVariableValue,
  RelayConsole,
  RelayConsoleCompletion,
  RelayConsoleLevel,
  RelayConsoleLine,
  RelayDesiredState,
  RelayInstance,
  RelayInstanceResources,
  RelayObservedState,
} from "@workspace/contracts"
import { brickVariableValuesSchema } from "@workspace/contracts"

import type { RelayConfig, RelayInstanceConfig } from "./config.js"
import { WEB_ROUTE_LABEL_PREFIX } from "./web-route-labels.js"
import type { RelayWebRouteLabelSnapshot } from "./web-route-labels.js"

interface DockerInspect {
  Config: {
    AttachStdin?: boolean
    AttachStdout?: boolean
    Image: string
    Labels: Record<string, string | undefined> | null
    OpenStdin?: boolean
    Tty?: boolean
  }
  Id: string
  Mounts: Array<{
    Destination: string
    Source: string
    RW: boolean
  }>
  Name: string
  State: {
    ExitCode: number
    OOMKilled: boolean
    Restarting: boolean
    Running: boolean
    StartedAt: string
    Status: string
  }
}

interface DockerRecreateInspect {
  Config: Record<string, unknown> & {
    Labels?: Record<string, string> | null
  }
  HostConfig: Record<string, unknown> & {
    NetworkMode?: string
  }
  NetworkSettings?: {
    Networks?: Record<
      string,
      {
        Aliases?: Array<string> | null
      }
    >
  }
  State: {
    Running: boolean
  }
}

interface DiscoveredInstance {
  config: RelayInstanceConfig
  container: DockerInspect
}

interface DockerStats {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number }
    online_cpus?: number
    system_cpu_usage?: number
  }
  precpu_stats?: {
    cpu_usage?: { total_usage?: number }
    system_cpu_usage?: number
  }
  memory_stats?: {
    limit?: number
    stats?: {
      inactive_file?: number
      total_inactive_file?: number
    }
    usage?: number
  }
  networks?: Record<
    string,
    {
      rx_bytes?: number
      tx_bytes?: number
    }
  >
}

interface ResourceCacheEntry {
  lastAttempt: number
  pending: boolean
  value: RelayInstanceResources | null
}

// Docker TTY logs contain ANSI/control bytes that must be removed before parsing.
/* eslint-disable no-control-regex */
const ANSI_PATTERN = new RegExp(
  "\\u001b(?:\\[[0-?]*[ -/]*[@-~]|\\][^\\u0007]*(?:\\u0007|\\u001b\\\\)|[=>])",
  "gu"
)
const CONTROL_PATTERN = new RegExp(
  "[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]",
  "gu"
)
const TERMINAL_EDIT_PATTERN = new RegExp(
  "(?:\\u0008|\\u001b\\[[0-?]*[ -/]*[ABCDEFGHJKSTfhl])",
  "u"
)
const MINECRAFT_LOG_PREFIX_PATTERN =
  /\[\d{2}:\d{2}:\d{2} (?:INFO|WARN(?:ING)?|ERROR|FATAL|SEVERE|DEBUG|TRACE)\]:/iu
const CONSOLE_TTY_COLUMNS = 120
const CONSOLE_TTY_ROWS = 40
/* eslint-enable no-control-regex */

export class DockerDriver {
  readonly #config: RelayConfig
  #cachedDockerVersion: string | null | undefined
  readonly #consoleLocks = new Map<string, Promise<void>>()
  readonly #consoleSizeStarts = new Map<string, string>()
  readonly #consoleSizePending = new Map<string, Promise<void>>()
  #relayStartedAt: Promise<string | null> | undefined
  readonly #resourceCache = new Map<string, ResourceCacheEntry>()

  constructor(config: RelayConfig) {
    this.#config = config
  }

  async inspectInstances(): Promise<Array<RelayInstance>> {
    const discovered = await this.#discover()
    const activeContainerIds = new Set(
      discovered.map(({ container }) => container.Id)
    )
    for (const containerId of this.#resourceCache.keys()) {
      if (!activeContainerIds.has(containerId))
        this.#resourceCache.delete(containerId)
    }
    for (const containerId of this.#consoleSizeStarts.keys()) {
      if (!activeContainerIds.has(containerId))
        this.#consoleSizeStarts.delete(containerId)
    }
    await Promise.all(
      discovered.map(({ config, container }) =>
        config.managedByRelay
          ? this.#ensureConsoleSize(container).catch(() => undefined)
          : Promise.resolve()
      )
    )

    const instances = discovered.map(({ config, container }) => {
      const desiredState: RelayDesiredState = container.State.Running
        ? "running"
        : "stopped"
      const observedState = this.#observedState(container)
      const resources = this.#resourcesFor({ config, container })

      return {
        ...config,
        containerId: container.Id.slice(0, 12),
        desiredState,
        observedState,
        startedAt: container.State.Running ? container.State.StartedAt : null,
        status: container.State.Running
          ? "Running"
          : `Exited (${container.State.ExitCode})`,
        resources,
      }
    })

    return instances.sort((a, b) =>
      `${a.implementation}-${a.version}`.localeCompare(
        `${b.implementation}-${b.version}`,
        undefined,
        { numeric: true }
      )
    )
  }

  async findInstance(id: string): Promise<RelayInstanceConfig | null> {
    const found = (await this.#discover()).find((item) =>
      matchesInstanceId(item.config, id)
    )
    return found?.config ?? null
  }

  async webRouteLabelSnapshots(): Promise<Array<RelayWebRouteLabelSnapshot>> {
    return (await this.#discover()).map(({ config, container }) => ({
      instanceId: config.id,
      labels: container.Config.Labels ?? {},
      service: config.service,
    }))
  }

  async runAction(
    instance: RelayInstanceConfig,
    action: "start" | "stop" | "restart" | "kill"
  ): Promise<RelayInstance> {
    if (instance.managedByRelay) {
      await command("docker", [action, instance.service], {
        timeout: action === "start" ? 120_000 : 90_000,
      })
    } else {
      const common = this.#composeArguments()
      const actionArguments =
        action === "start"
          ? ["up", "--detach", "--no-deps", instance.service]
          : [action, instance.service]

      await command("docker", [...common, ...actionArguments], {
        cwd: this.#config.projectDirectory,
        timeout: action === "start" ? 120_000 : 90_000,
      })
    }

    const current = await this.inspectInstances()
    const updated = current.find((item) => item.id === instance.id)
    if (!updated) throw new Error(`Instance ${instance.id} disappeared`)
    return updated
  }

  async recreateOwnedInstance(
    instance: RelayInstanceConfig,
    routeLabels: Readonly<Record<string, string>>,
    edgeNetwork: string | null
  ): Promise<RelayInstance> {
    if (!instance.managedByRelay) {
      throw new Error("Relay can only recreate containers it created")
    }

    const inspected = await command("docker", ["inspect", instance.service])
    const current = (
      JSON.parse(inspected.stdout) as Array<DockerRecreateInspect>
    )[0]
    if (!current)
      throw new Error(`Docker could not inspect ${instance.service}`)

    const labels = { ...current.Config.Labels }
    for (const label of Object.keys(labels)) {
      if (
        label.startsWith("traefik.http.") ||
        label === "traefik.enable" ||
        label === "traefik.docker.network" ||
        label.startsWith(WEB_ROUTE_LABEL_PREFIX)
      ) {
        delete labels[label]
      }
    }
    Object.assign(labels, routeLabels)

    const primaryNetwork = Object.hasOwn(
      current.NetworkSettings?.Networks ?? {},
      "kiln-minecraft"
    )
      ? "kiln-minecraft"
      : current.HostConfig.NetworkMode
    if (!primaryNetwork || primaryNetwork === "default") {
      throw new Error(
        `Relay cannot safely recreate ${instance.name} without its primary Docker network`
      )
    }

    const backupName = `${instance.service}-kiln-backup-${Date.now()}`
    let replacementCreated = false
    if (current.State.Running) {
      await command("docker", ["stop", "--time", "30", instance.service], {
        timeout: 45_000,
      })
    }
    await command("docker", ["rename", instance.service, backupName])

    try {
      await this.#dockerJson(
        "POST",
        `/containers/create?name=${encodeURIComponent(instance.service)}`,
        {
          ...current.Config,
          HostConfig: {
            ...current.HostConfig,
            NetworkMode: primaryNetwork,
          },
          Labels: labels,
          NetworkingConfig: {
            EndpointsConfig: {
              [primaryNetwork]: {
                Aliases: [instance.service],
              },
            },
          },
        }
      )
      replacementCreated = true
      if (edgeNetwork) {
        await command("docker", [
          "network",
          "connect",
          "--alias",
          instance.service,
          edgeNetwork,
          instance.service,
        ])
      }
      await command("docker", ["start", instance.service], {
        timeout: 120_000,
      })
    } catch (cause) {
      if (replacementCreated) {
        await command("docker", ["rm", "--force", instance.service]).catch(
          () => undefined
        )
      }
      await command("docker", ["rename", backupName, instance.service]).catch(
        () => undefined
      )
      await command("docker", ["start", instance.service], {
        timeout: 120_000,
      }).catch(() => undefined)
      throw new Error(
        `Kiln could not apply web routes to ${instance.name}; the previous container was restored.`,
        { cause }
      )
    }
    await command("docker", ["rm", "--force", backupName], {
      timeout: 90_000,
    }).catch((cause: unknown) => {
      console.warn(
        `Kiln applied web routes to ${instance.name}, but could not remove backup container ${backupName}.`,
        cause
      )
    })

    const updated = (await this.inspectInstances()).find(
      (item) => item.id === instance.id
    )
    if (!updated) throw new Error(`Instance ${instance.id} disappeared`)
    return updated
  }

  async console(
    instance: RelayInstanceConfig,
    limit = 2_000
  ): Promise<RelayConsole> {
    const discovered = await this.#findDiscovered(instance.id)
    const boundedLimit = Math.min(Math.max(limit, 100), 5_000)
    const result = await command(
      "docker",
      [
        "logs",
        "--timestamps",
        "--tail",
        String(boundedLimit),
        discovered.container.Id,
      ],
      { timeout: 15_000 }
    )
    const rawLines = `${result.stdout}\n${result.stderr}`
      .split("\n")
      .map(parseConsoleLine)
      .filter((line): line is ParsedConsoleLine => line !== null)
    const occurrences = new Map<string, number>()

    return {
      instanceId: instance.id,
      lines: rawLines.map((line) => {
        const hash = createHash("sha1")
          .update(`${line.timestamp ?? ""}\u0000${line.text}`)
          .digest("hex")
          .slice(0, 14)
        const occurrence = occurrences.get(hash) ?? 0
        occurrences.set(hash, occurrence + 1)
        return { ...line, id: `${hash}-${occurrence}` }
      }),
      truncated: rawLines.length >= boundedLimit,
    }
  }

  async *streamConsole(
    instance: RelayInstanceConfig,
    signal: AbortSignal,
    limit = 3_000
  ): AsyncGenerator<RelayConsoleLine> {
    const discovered = await this.#findDiscovered(instance.id)
    const boundedLimit = Math.min(Math.max(limit, 100), 5_000)
    const child = spawn(
      "docker",
      [
        "logs",
        "--follow",
        "--timestamps",
        "--tail",
        String(boundedLimit),
        discovered.container.Id,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    )
    const pending: Array<RelayConsoleLine> = []
    const occurrences = new Map<string, number>()
    let stdoutBuffer = ""
    let stderrBuffer = ""
    let wake: (() => void) | null = null
    const streamState: { closed: boolean; failure: Error | null } = {
      closed: false,
      failure: null,
    }

    const notify = () => {
      wake?.()
      wake = null
    }
    const queueLine = (value: string) => {
      const parsed = parseConsoleLine(value)
      if (!parsed) return
      const hash = createHash("sha1")
        .update(`${parsed.timestamp ?? ""}\u0000${parsed.text}`)
        .digest("hex")
        .slice(0, 14)
      const occurrence = occurrences.get(hash) ?? 0
      occurrences.set(hash, occurrence + 1)
      pending.push({ ...parsed, id: `${hash}-${occurrence}` })
      notify()
    }
    const consume = (source: "stdout" | "stderr", chunk: Buffer) => {
      const current =
        (source === "stdout" ? stdoutBuffer : stderrBuffer) +
        chunk.toString("utf8")
      const lines = current.split("\n")
      const remainder = lines.pop() ?? ""
      if (source === "stdout") stdoutBuffer = remainder
      else stderrBuffer = remainder
      for (const line of lines) queueLine(line)
    }
    const stop = () => {
      if (!child.killed) child.kill("SIGTERM")
    }

    child.stdout.on("data", (chunk: Buffer) => consume("stdout", chunk))
    child.stderr.on("data", (chunk: Buffer) => consume("stderr", chunk))
    child.on("error", (error) => {
      streamState.failure = error
      streamState.closed = true
      notify()
    })
    child.on("close", (code) => {
      if (stdoutBuffer) queueLine(stdoutBuffer)
      if (stderrBuffer) queueLine(stderrBuffer)
      if (!signal.aborted && code && code !== 143) {
        streamState.failure = new Error(
          `Docker log stream exited with code ${code}`
        )
      }
      streamState.closed = true
      notify()
    })
    signal.addEventListener("abort", stop, { once: true })

    try {
      while (!streamState.closed || pending.length > 0) {
        if (pending.length === 0) {
          await new Promise<void>((resolvePromise) => {
            wake = resolvePromise
          })
          continue
        }
        const next = pending.shift()
        if (next) yield next
      }
      if (streamState.failure) throw streamState.failure
    } finally {
      signal.removeEventListener("abort", stop)
      stop()
    }
  }

  async sendCommand(
    instance: RelayInstanceConfig,
    input: string
  ): Promise<void> {
    await this.#withConsoleLock(instance.id, async () => {
      const discovered = await this.#findDiscovered(instance.id)
      if (!discovered.container.State.Running) {
        throw new Error(`${instance.name} is not running`)
      }
      await this.#writeConsoleInput(discovered.container.Id, `${input}\n`)
    })
  }

  async completeCommand(
    instance: RelayInstanceConfig,
    input: string,
    cursor: number
  ): Promise<RelayConsoleCompletion> {
    const emptyResult: RelayConsoleCompletion = {
      instanceId: instance.id,
      supported: false,
      completedPrefix: null,
      suggestions: [],
    }
    const implementation = (instance.brickId ?? instance.implementation)
      .trim()
      .toLowerCase()
    if (!["paper", "folia", "purpur"].includes(implementation)) {
      return emptyResult
    }

    return this.#withConsoleLock(instance.id, async () => {
      const discovered = await this.#findDiscovered(instance.id)
      const { Config: containerConfig, State: state } = discovered.container
      if (
        !state.Running ||
        !containerConfig.Tty ||
        !containerConfig.OpenStdin ||
        !containerConfig.AttachStdin ||
        !containerConfig.AttachStdout
      ) {
        return emptyResult
      }

      const prefix = input.slice(0, cursor)
      const output = await this.#probeConsoleCompletion(
        discovered.container.Id,
        prefix
      )
      const completion = parseConsoleCompletion(prefix, output)
      return {
        instanceId: instance.id,
        supported: true,
        ...completion,
      }
    })
  }

  async dockerVersion(): Promise<string | null> {
    if (this.#cachedDockerVersion !== undefined) {
      return this.#cachedDockerVersion
    }
    try {
      const result = await command("docker", [
        "version",
        "--format",
        "{{.Server.Version}}",
      ])
      this.#cachedDockerVersion = result.stdout.trim() || null
    } catch {
      this.#cachedDockerVersion = null
    }
    return this.#cachedDockerVersion
  }

  relayStartedAt(): Promise<string | null> {
    this.#relayStartedAt ??= this.#inspectRelayStartedAt()
    return this.#relayStartedAt
  }

  async #inspectRelayStartedAt(): Promise<string | null> {
    try {
      const result = await command(
        "docker",
        ["inspect", "--format", "{{.State.StartedAt}}", hostname()],
        { timeout: 2_500 }
      )
      const value = result.stdout.trim()
      const timestamp = Date.parse(value)
      return Number.isFinite(timestamp)
        ? new Date(timestamp).toISOString()
        : null
    } catch {
      return null
    }
  }

  async #withConsoleLock<T>(
    instanceId: string,
    action: () => Promise<T>
  ): Promise<T> {
    const previous = this.#consoleLocks.get(instanceId) ?? Promise.resolve()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolvePromise) => {
      release = resolvePromise
    })
    const current = previous.catch(() => undefined).then(() => gate)
    this.#consoleLocks.set(instanceId, current)
    await previous.catch(() => undefined)
    try {
      return await action()
    } finally {
      release()
      if (this.#consoleLocks.get(instanceId) === current) {
        this.#consoleLocks.delete(instanceId)
      }
    }
  }

  async #writeConsoleInput(containerId: string, input: string): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const attachPath = `/containers/${encodeURIComponent(containerId)}/attach?stream=1&stdin=1&stdout=0&stderr=0`
      const attachRequest = request({
        socketPath: this.#config.dockerSocket,
        path: attachPath,
        method: "POST",
        headers: { Connection: "Upgrade", Upgrade: "tcp" },
      })
      let settled = false
      const settle = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) rejectPromise(error)
        else resolvePromise()
      }
      const timer = setTimeout(() => {
        attachRequest.destroy(new Error("Docker attach timed out"))
      }, 5_000)

      attachRequest.on("upgrade", (_response, socket) => {
        socket.write(input, (error) => {
          if (error) {
            socket.destroy()
            settle(error)
            return
          }
          setTimeout(() => {
            socket.destroy()
            settle()
          }, 30)
        })
      })
      attachRequest.on("response", (response) => {
        response.resume()
        settle(
          new Error(`Docker attach returned HTTP ${response.statusCode ?? 500}`)
        )
      })
      attachRequest.on("error", (error) => settle(error))
      attachRequest.end()
    })
  }

  async #ensureConsoleSize(container: DockerInspect): Promise<void> {
    const { Id: containerId, Config: config, State: state } = container
    if (!state.Running || !config.Tty) return
    if (this.#consoleSizeStarts.get(containerId) === state.StartedAt) return

    const pending = this.#consoleSizePending.get(containerId)
    if (pending) {
      await pending
      if (this.#consoleSizeStarts.get(containerId) === state.StartedAt) return
    }

    const resize = this.#resizeConsole(containerId)
      .then(() => {
        this.#consoleSizeStarts.set(containerId, state.StartedAt)
      })
      .finally(() => this.#consoleSizePending.delete(containerId))
    this.#consoleSizePending.set(containerId, resize)
    await resize
  }

  async #resizeConsole(containerId: string): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const resizePath = `/containers/${encodeURIComponent(containerId)}/resize?h=${CONSOLE_TTY_ROWS}&w=${CONSOLE_TTY_COLUMNS}`
      const resizeRequest = request({
        socketPath: this.#config.dockerSocket,
        path: resizePath,
        method: "POST",
      })
      let settled = false
      const settle = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) rejectPromise(error)
        else resolvePromise()
      }
      const timer = setTimeout(() => {
        resizeRequest.destroy(new Error("Docker console resize timed out"))
      }, 5_000)

      resizeRequest.on("response", (response) => {
        response.resume()
        const status = response.statusCode ?? 500
        if (status >= 200 && status < 300) settle()
        else settle(new Error(`Docker console resize returned HTTP ${status}`))
      })
      resizeRequest.on("error", (error) => settle(error))
      resizeRequest.end()
    })
  }

  async #probeConsoleCompletion(
    containerId: string,
    prefix: string
  ): Promise<string> {
    return new Promise<string>((resolvePromise, rejectPromise) => {
      const attachPath = `/containers/${encodeURIComponent(containerId)}/attach?stream=1&stdin=1&stdout=1&stderr=1`
      const attachRequest = request({
        socketPath: this.#config.dockerSocket,
        path: attachPath,
        method: "POST",
        headers: { Connection: "Upgrade", Upgrade: "tcp" },
      })
      let output = ""
      let capturing = false
      let settled = false
      let attachReadyTimer: ReturnType<typeof setTimeout> | null = null
      let clearLineTimer: ReturnType<typeof setTimeout> | null = null
      let quietTimer: ReturnType<typeof setTimeout> | null = null
      let hardTimer: ReturnType<typeof setTimeout> | null = null
      const requestTimer = setTimeout(() => {
        attachRequest.destroy(new Error("Docker completion attach timed out"))
      }, 5_000)

      const settle = (value: string, error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(requestTimer)
        if (attachReadyTimer) clearTimeout(attachReadyTimer)
        if (clearLineTimer) clearTimeout(clearLineTimer)
        if (quietTimer) clearTimeout(quietTimer)
        if (hardTimer) clearTimeout(hardTimer)
        if (error) rejectPromise(error)
        else resolvePromise(value)
      }

      attachRequest.on("upgrade", (_response, socket) => {
        clearTimeout(requestTimer)
        const finish = () => {
          if (settled) return
          capturing = false
          socket.write("\u0015")
          setTimeout(() => {
            socket.destroy()
            settle(output)
          }, 20)
        }
        socket.on("data", (chunk: Buffer) => {
          if (!capturing) return
          output += chunk.toString("utf8")
          if (output.length >= 65_536) {
            output = output.slice(0, 65_536)
            finish()
            return
          }
          if (quietTimer) clearTimeout(quietTimer)
          quietTimer = setTimeout(finish, 120)
        })
        socket.on("error", (error) => settle("", error))
        // Docker reports the upgraded attach socket before the container TTY is
        // ready to consume input. Paper silently drops a probe sent immediately.
        attachReadyTimer = setTimeout(() => {
          if (settled) return
          socket.write("\u0015", (clearError) => {
            if (clearError) settle("", clearError)
          })
          clearLineTimer = setTimeout(() => {
            if (settled) return
            output = ""
            capturing = true
            socket.write(`${prefix}\t`, (error) => {
              if (error) settle("", error)
            })
            hardTimer = setTimeout(finish, 800)
          }, 25)
        }, 50)
      })
      attachRequest.on("response", (response) => {
        response.resume()
        settle(
          "",
          new Error(`Docker attach returned HTTP ${response.statusCode ?? 500}`)
        )
      })
      attachRequest.on("error", (error) => settle("", error))
      attachRequest.end()
    })
  }

  #resourcesFor(instance: DiscoveredInstance): RelayInstanceResources | null {
    const key = instance.container.Id
    const now = Date.now()
    const cached = this.#resourceCache.get(key) ?? {
      lastAttempt: 0,
      pending: false,
      value: null,
    }

    if (
      instance.container.State.Running &&
      !cached.pending &&
      now - cached.lastAttempt >= 1_500
    ) {
      cached.lastAttempt = now
      cached.pending = true
      this.#resourceCache.set(key, cached)
      void this.#sampleResources(instance, cached.value)
        .then((resources) => {
          cached.value = resources
        })
        .catch(() => {
          // Resource sampling is observational. Keep the last healthy value so
          // a slow Docker stats response can never take down the Relay snapshot.
        })
        .finally(() => {
          cached.pending = false
        })
    } else if (!instance.container.State.Running) {
      cached.value = null
      this.#resourceCache.set(key, cached)
    }

    return cached.value
  }

  async #sampleResources(
    instance: DiscoveredInstance,
    previous: RelayInstanceResources | null
  ): Promise<RelayInstanceResources> {
    const directory = resolve(
      this.#config.rootDirectory,
      instance.config.directory
    )
    const [stats, filesystem] = await Promise.all([
      this.#dockerStats(instance.container.Id),
      statfs(directory),
    ])
    const cpuCurrent = stats.cpu_stats?.cpu_usage?.total_usage ?? 0
    const cpuPrevious = stats.precpu_stats?.cpu_usage?.total_usage ?? 0
    const systemCurrent = stats.cpu_stats?.system_cpu_usage ?? 0
    const systemPrevious = stats.precpu_stats?.system_cpu_usage ?? 0
    const cpuDelta = cpuCurrent - cpuPrevious
    const systemDelta = systemCurrent - systemPrevious
    const onlineCpus = Math.max(stats.cpu_stats?.online_cpus ?? 1, 1)
    const cpuPercent =
      cpuDelta > 0 && systemDelta > 0
        ? (cpuDelta / systemDelta) * onlineCpus * 100
        : 0

    const memoryTotal = Math.max(stats.memory_stats?.limit ?? 0, 0)
    const memoryCache = Math.max(
      stats.memory_stats?.stats?.total_inactive_file ??
        stats.memory_stats?.stats?.inactive_file ??
        0,
      0
    )
    const memoryUsed = Math.max(
      Math.min((stats.memory_stats?.usage ?? 0) - memoryCache, memoryTotal),
      0
    )
    const storageTotal = filesystem.blocks * filesystem.bsize
    const storageAvailable = filesystem.bavail * filesystem.bsize
    const storageUsed = Math.max(storageTotal - storageAvailable, 0)
    const network = Object.values(stats.networks ?? {}).reduce(
      (total, current) => ({
        receivedBytes: total.receivedBytes + (current.rx_bytes ?? 0),
        sentBytes: total.sentBytes + (current.tx_bytes ?? 0),
      }),
      { receivedBytes: 0, sentBytes: 0 }
    )
    const sampledAt = Date.now()
    const previousSampledAt = previous
      ? Date.parse(previous.sampledAt)
      : Number.NaN
    const elapsedSeconds = Number.isFinite(previousSampledAt)
      ? Math.max((sampledAt - previousSampledAt) / 1_000, 0)
      : 0
    const receivedBytesPerSecond =
      previous?.network && elapsedSeconds > 0
        ? Math.max(
            (network.receivedBytes - previous.network.receivedBytes) /
              elapsedSeconds,
            0
          )
        : 0
    const sentBytesPerSecond =
      previous?.network && elapsedSeconds > 0
        ? Math.max(
            (network.sentBytes - previous.network.sentBytes) / elapsedSeconds,
            0
          )
        : 0

    return {
      sampledAt: new Date(sampledAt).toISOString(),
      cpu: { percent: roundPercent(cpuPercent) },
      memory: {
        totalBytes: memoryTotal,
        usedBytes: memoryUsed,
        percent: roundPercent(percentOf(memoryUsed, memoryTotal)),
      },
      storage: {
        totalBytes: storageTotal,
        usedBytes: storageUsed,
        percent: roundPercent(percentOf(storageUsed, storageTotal)),
      },
      network: {
        ...network,
        receivedBytesPerSecond,
        sentBytesPerSecond,
      },
    }
  }

  async #dockerStats(containerId: string): Promise<DockerStats> {
    return new Promise<DockerStats>((resolvePromise, rejectPromise) => {
      const statsRequest = request({
        socketPath: this.#config.dockerSocket,
        path: `/containers/${encodeURIComponent(containerId)}/stats?stream=false`,
        method: "GET",
      })
      const chunks: Array<Buffer> = []
      let size = 0
      const timer = setTimeout(() => {
        statsRequest.destroy(new Error("Docker stats timed out"))
      }, 2_500)

      statsRequest.on("response", (response) => {
        response.on("error", (error) => {
          clearTimeout(timer)
          rejectPromise(error)
        })
        if ((response.statusCode ?? 500) >= 400) {
          response.resume()
          clearTimeout(timer)
          rejectPromise(
            new Error(
              `Docker stats returned HTTP ${response.statusCode ?? 500}`
            )
          )
          return
        }
        response.on("data", (chunk: Buffer) => {
          size += chunk.length
          if (size > 1024 * 1024) {
            statsRequest.destroy(
              new Error("Docker stats response was too large")
            )
            return
          }
          chunks.push(chunk)
        })
        response.on("end", () => {
          clearTimeout(timer)
          try {
            resolvePromise(
              JSON.parse(Buffer.concat(chunks).toString("utf8")) as DockerStats
            )
          } catch (error) {
            rejectPromise(error)
          }
        })
      })
      statsRequest.on("error", (error) => {
        clearTimeout(timer)
        rejectPromise(error)
      })
      statsRequest.end()
    })
  }

  async #dockerJson(
    method: "POST",
    path: string,
    body: unknown
  ): Promise<unknown> {
    return new Promise((resolvePromise, rejectPromise) => {
      const encoded = Buffer.from(JSON.stringify(body))
      const dockerRequest = request({
        headers: {
          "Content-Length": String(encoded.byteLength),
          "Content-Type": "application/json",
        },
        method,
        path,
        socketPath: this.#config.dockerSocket,
      })
      const chunks: Array<Buffer> = []
      let size = 0
      const timer = setTimeout(() => {
        dockerRequest.destroy(new Error("Docker API request timed out"))
      }, 60_000)

      dockerRequest.on("response", (response) => {
        response.on("data", (chunk: Buffer) => {
          size += chunk.length
          if (size > 1024 * 1024) {
            dockerRequest.destroy(
              new Error("Docker API response was too large")
            )
            return
          }
          chunks.push(chunk)
        })
        response.on("end", () => {
          clearTimeout(timer)
          const text = Buffer.concat(chunks).toString("utf8")
          if ((response.statusCode ?? 500) >= 400) {
            let message = text
            try {
              const parsed = JSON.parse(text) as { message?: unknown }
              if (typeof parsed.message === "string") message = parsed.message
            } catch {
              // Docker occasionally returns a plain-text proxy error.
            }
            rejectPromise(
              new Error(
                `Docker API returned HTTP ${response.statusCode ?? 500}: ${message || "request failed"}`
              )
            )
            return
          }
          try {
            resolvePromise(text ? (JSON.parse(text) as unknown) : null)
          } catch (cause) {
            rejectPromise(cause)
          }
        })
      })
      dockerRequest.on("error", (cause) => {
        clearTimeout(timer)
        rejectPromise(cause)
      })
      dockerRequest.end(encoded)
    })
  }

  async #findDiscovered(id: string): Promise<DiscoveredInstance> {
    const found = (await this.#discover()).find((item) =>
      matchesInstanceId(item.config, id)
    )
    if (!found) throw new Error(`Instance ${id} is no longer managed by Kiln`)
    return found
  }

  async #discover(): Promise<Array<DiscoveredInstance>> {
    const idsResult = await command("docker", [
      "container",
      "ls",
      "--all",
      "--filter",
      `label=${this.#config.managedLabel}`,
      "--format",
      "{{.ID}}",
    ])
    const ids = idsResult.stdout.split("\n").filter(Boolean)
    if (ids.length === 0) return []

    const inspectResult = await command("docker", ["inspect", ...ids])
    const containers = JSON.parse(inspectResult.stdout) as Array<DockerInspect>
    const discovered = containers.map((container) => ({
      container,
      config: this.#instanceConfig(container),
    }))
    const fullIds = new Set<string>()
    const shortIds = new Set<string>()
    for (const { config } of discovered) {
      if (fullIds.has(config.id)) {
        throw new Error(`Duplicate kiln.server.id ${config.id}`)
      }
      if (shortIds.has(config.shortId)) {
        throw new Error(
          `The first 8 characters of kiln.server.id must be unique; ${config.shortId} is duplicated`
        )
      }
      fullIds.add(config.id)
      shortIds.add(config.shortId)
    }
    return discovered
  }

  #instanceConfig(container: DockerInspect): RelayInstanceConfig {
    const labels = container.Config.Labels ?? {}
    const configuredMount = labels["kiln.instance.mount"]
    const serverMount = container.Mounts.find(
      (mount) =>
        (mount.Destination === configuredMount ||
          mount.Destination === "/server" ||
          mount.Destination === "/data") &&
        mount.RW
    )
    if (!serverMount) {
      throw new Error(`${container.Name} has no writable /server bind mount`)
    }

    const directory = resolve(serverMount.Source)
    const owned = labels["kiln.relay.owned"] === "true"
    const ownedDirectory = labels["kiln.instance.directory"]
    const usesOwnedDirectory = Boolean(
      owned && ownedDirectory && /^[a-f0-9]{40}$/iu.test(ownedDirectory)
    )
    let relativeDirectory =
      usesOwnedDirectory && ownedDirectory
        ? ownedDirectory
        : relative(this.#config.rootDirectory, directory)
    if (
      !usesOwnedDirectory &&
      (!relativeDirectory ||
        relativeDirectory.startsWith("..") ||
        resolve(this.#config.rootDirectory, relativeDirectory) !== directory)
    ) {
      const mountedDirectory = basename(directory)
      if (!existsSync(resolve(this.#config.rootDirectory, mountedDirectory))) {
        throw new Error(
          `${container.Name} mounts a directory outside the Relay data directory`
        )
      }
      relativeDirectory = mountedDirectory
    }
    const directoryName = basename(directory)
    const name = labels["kiln.instance.name"] ?? directoryName
    const parsed = name.match(/^([a-z][a-z0-9-]*)-(\d.*)$/u)
    const brickId = labels["kiln.brick.id"]
    const validBrickId =
      brickId && /^[a-z0-9][a-z0-9.-]{0,63}$/u.test(brickId)
        ? brickId
        : undefined
    const brickNetworkMode = labels["kiln.brick.network-mode"]
    const validNetworkMode =
      brickNetworkMode === "direct" ||
      brickNetworkMode === "minecraft-backend" ||
      brickNetworkMode === "minecraft-proxy"
        ? brickNetworkMode
        : undefined
    const primaryPort = Number(labels["kiln.brick.primary-port"])
    const implementation = titleCase(validBrickId ?? parsed?.[1] ?? name)
    const version =
      labels["kiln.instance.version"] ??
      parsed?.[2] ??
      inferStandaloneVersion(directory, name)
    const service = owned
      ? container.Name.replace(/^\//u, "")
      : (container.Config.Labels?.["com.docker.compose.service"] ??
        container.Name.replace(/^\//u, ""))
    const imageTag =
      labels["kiln.instance.java"] ??
      container.Config.Image.split(":").at(-1) ??
      "Unknown"
    const rawId = container.Config.Labels?.[this.#config.serverIdLabel]
    if (!rawId || !/^[a-f0-9]{40}$/iu.test(rawId)) {
      throw new Error(
        `${container.Name} must have a ${this.#config.serverIdLabel} label containing 40 hexadecimal characters`
      )
    }
    const id = rawId.toLowerCase()
    const host = parsed
      ? `${version}.${implementation.toLowerCase()}.${this.#config.connectDomain}`
      : `${implementation.toLowerCase()}.${this.#config.connectDomain}`

    return {
      brickFormat: labels["kiln.brick.format"],
      brickId: validBrickId,
      brickNetworkMode: validNetworkMode,
      brickPrimaryPort:
        Number.isInteger(primaryPort) &&
        primaryPort >= 1 &&
        primaryPort <= 65_535
          ? primaryPort
          : undefined,
      brickSource: labels["kiln.brick.source"],
      connectAddress:
        labels["kiln.instance.hostname"] ??
        (this.#config.connectPort === 25_565
          ? host
          : `${host}:${this.#config.connectPort}`),
      directory: relativeDirectory,
      game:
        labels["kiln.instance.game"] ??
        (validBrickId === "palworld" ? "Palworld" : "Minecraft"),
      id,
      implementation,
      javaVersion: imageTag,
      name,
      shortId: id.slice(0, 8),
      service,
      variables: parseBrickVariablesLabel(labels["kiln.brick.variables"]),
      version,
      managedByRelay: owned,
    }
  }

  #observedState(container: DockerInspect): RelayObservedState {
    if (container.State.Restarting || container.State.Status === "restarting") {
      return "starting"
    }
    if (container.State.Running) return "running"
    if (container.State.OOMKilled) return "failed"
    return container.State.ExitCode === 0 || container.State.ExitCode === 143
      ? "offline"
      : "failed"
  }

  #composeArguments(): Array<string> {
    return [
      "compose",
      "--file",
      this.#config.composeFile,
      "--project-directory",
      this.#config.projectDirectory,
      "--project-name",
      this.#config.projectName,
    ]
  }
}

function matchesInstanceId(instance: RelayInstanceConfig, id: string): boolean {
  return instance.id === id || instance.shortId === id || instance.name === id
}

function parseBrickVariablesLabel(
  value: string | undefined
): Record<string, BrickVariableValue> | undefined {
  if (!value) return undefined
  try {
    return brickVariableValuesSchema.parse(JSON.parse(value))
  } catch {
    return undefined
  }
}

function percentOf(used: number, total: number): number {
  return total > 0 ? (used / total) * 100 : 0
}

function roundPercent(value: number): number {
  return Math.round(Math.max(value, 0) * 10) / 10
}

interface ParsedConsoleLine {
  level: RelayConsoleLevel
  text: string
  timestamp: string | null
}

function parseConsoleLine(value: string): ParsedConsoleLine | null {
  if (isTerminalOnlyConsoleFrame(value)) return null
  const normalized = stripAnsi(value)
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2}T\S+Z)\s(.*)$/u)
  const timestamp = match?.[1] ?? null
  const text = (match?.[2] ?? normalized)
    .replace(/(?:>\.\.\.\.|…)+/gu, "")
    .replace(CONTROL_PATTERN, "")
    .trim()
    .replace(/^[>=]+\s*(?=\[\d{2}:\d{2}:\d{2})/u, "")
  if (!text || text === "list") return null

  let level: RelayConsoleLevel = "info"
  if (/\b(?:ERROR|FATAL|SEVERE)\b/iu.test(text)) level = "error"
  else if (/\bWARN(?:ING)?\b/iu.test(text)) level = "warn"
  else if (/\bDEBUG\b/iu.test(text)) level = "debug"
  else if (/\bTRACE\b/iu.test(text)) level = "trace"

  return { timestamp, text, level }
}

function isTerminalOnlyConsoleFrame(value: string): boolean {
  const normalized = stripAnsi(value)
  if (MINECRAFT_LOG_PREFIX_PATTERN.test(normalized)) return false
  const terminalText = normalized
    .replace(/^\d{4}-\d{2}-\d{2}T\S+Z\s*/u, "")
    .trimStart()
  if (/^>\s*/u.test(terminalText)) return true
  if (TERMINAL_EDIT_PATTERN.test(value)) return true

  const ansiSequenceCount = value.match(ANSI_PATTERN)?.length ?? 0
  if (ansiSequenceCount >= 4 && /\S+\s{2,}\S+/u.test(normalized)) return true

  const terminalColumns = normalized
    .replace(/^\d{4}-\d{2}-\d{2}T\S+Z\s*/u, "")
    .trim()
    .split(/\s{2,}/u)
  return (
    terminalColumns.length >= 2 &&
    terminalColumns.every((column) => /^[a-z0-9_:.?+/-]+$/iu.test(column))
  )
}

function parseConsoleCompletion(
  prefix: string,
  output: string
): Pick<RelayConsoleCompletion, "completedPrefix" | "suggestions"> {
  if (output.includes("\n")) {
    const suggestions = output
      .split(/\r*\n/gu)
      .slice(1)
      .flatMap((line) =>
        stripAnsi(line)
          .replace(CONTROL_PATTERN, "")
          .trim()
          .split(/\s{2,}/gu)
      )
      .map((suggestion) => suggestion.trim())
      .filter(
        (suggestion) =>
          suggestion.length > 0 &&
          suggestion !== prefix &&
          !MINECRAFT_LOG_PREFIX_PATTERN.test(suggestion)
      )
      .filter(
        (suggestion, index, values) => values.indexOf(suggestion) === index
      )
      .slice(0, 100)
    return { completedPrefix: null, suggestions }
  }

  if (output.includes("\u0007")) {
    return { completedPrefix: null, suggestions: [] }
  }

  const rendered = renderTerminalLine(output).trimEnd()
  const afterLastBackspace = stripAnsi(
    output.slice(output.lastIndexOf("\b") + 1)
  )
    .replace(CONTROL_PATTERN, "")
    .trim()
  const tokenStart = Math.max(prefix.lastIndexOf(" ") + 1, 0)
  const typedToken = prefix.slice(tokenStart)
  const completedToken =
    afterLastBackspace.startsWith(typedToken) &&
    afterLastBackspace !== typedToken
      ? `${prefix.slice(0, tokenStart)}${afterLastBackspace}`
      : null
  const completedPrefix =
    completedToken ??
    (afterLastBackspace.startsWith(prefix) && afterLastBackspace !== prefix
      ? afterLastBackspace
      : rendered.startsWith(prefix) && rendered !== prefix
        ? rendered
        : null)
  return { completedPrefix, suggestions: [] }
}

function renderTerminalLine(value: string): string {
  const visible = value.replace(ANSI_PATTERN, "")
  const cells: Array<string> = []
  let cursor = 0
  for (const character of visible) {
    if (character === "\r") {
      cursor = 0
      continue
    }
    if (character === "\b") {
      cursor = Math.max(0, cursor - 1)
      continue
    }
    if (character === "\n") {
      cells.length = 0
      cursor = 0
      continue
    }
    const codePoint = character.charCodeAt(0)
    if (
      codePoint <= 8 ||
      (codePoint >= 11 && codePoint <= 12) ||
      (codePoint >= 14 && codePoint <= 31) ||
      codePoint === 127
    ) {
      continue
    }
    cells[cursor] = character
    cursor += 1
  }
  return cells.join("")
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "").replace(/\r/gu, "")
}

function titleCase(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function inferStandaloneVersion(
  directory: string,
  implementation: string
): string {
  const escaped = implementation.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const jarPattern = new RegExp(`^${escaped}-(.+)\\.jar$`, "iu")
  try {
    for (const entry of readdirSync(directory)) {
      const version = entry.match(jarPattern)?.[1]
      if (version) return version
    }
  } catch {
    // Keep discovery resilient if the mount changes after Docker inspect.
  }
  return "Unknown"
}
