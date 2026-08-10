import type { CliPrincipal } from "@/effect/cli-access"
import {
  cliActivityResponseSchema,
  cliCreateServerRequestSchema,
  cliDeleteServerRequestSchema,
  cliFileTargetSchema,
  cliFileWriteRequestSchema,
  cliPowerRequestSchema,
  cliRelayInfoResponseSchema,
  cliRelaySchema,
  cliRelaysResponseSchema,
  cliRemoteFileUploadRequestSchema,
  cliRemoteFileUploadResponseSchema,
  cliServerSchema,
  cliServerInfoResponseSchema,
  cliServerMutationResponseSchema,
  cliSftpResponseSchema,
  cliUpdateServerStartupRequestSchema,
  relayCatalogSchema,
  relayConsoleCommandResultSchema,
  relayConsoleSchema,
  relayFileContentSchema,
  relayFileTreeSchema,
  relayInstanceSchema,
  relayRemoteFileUploadSchema,
  relayRemoteFileUploadResultSchema,
  relaySnapshotSchema,
} from "@workspace/contracts"
import { Effect, Option, Result } from "effect"
import { z } from "zod"

import { cliRelaySubject, requireCliWrite } from "@/effect/cli-access"
import { CliAccessError } from "@/effect/errors"
import {
  allowedInstanceIdsEffect,
  isPlatformAdmin,
  listUserGrantsEffect,
  requireRelayPermissionEffect,
} from "@/lib/access-control"
import type { AccessPermission } from "@/lib/permissions"
import { roleHasPermission } from "@/lib/permissions"
import { invalidateRelayCache, relayCachePolicy } from "@/lib/relay-client"
import { relayRpc } from "@/lib/relay-connection"
import {
  listPersistedRelaysEffect,
  type PersistedRelay,
} from "@/lib/relay-registry"
import { getActivityForUser } from "@/server/activity"
import {
  deleteInstanceDomainEffect,
  provisionInstanceDomainBestEffort,
} from "@/server/domains.server"
import { finalizeInstanceDeletionEffect } from "@/server/instance-deletion-cleanup"

const CLI_RELAY_LONG_OPERATION_TIMEOUT_MS = 180_000

type RelaySftpConnection = NonNullable<
  z.infer<typeof relaySnapshotSchema>["relay"]
>["sftp"]

export const collectAvailableCliRelaySnapshotsEffect = Effect.fn(
  "cli.api.servers.collectAvailableRelays"
)(function* <TSnapshot>(
  requests: ReadonlyArray<{
    relayId: string
    snapshot: Effect.Effect<TSnapshot, CliAccessError>
  }>
) {
  const snapshots = yield* Effect.forEach(
    requests,
    ({ relayId, snapshot }) =>
      snapshot.pipe(
        Effect.map(Option.some),
        Effect.catchTag("CliAccessError", (error) =>
          Effect.logWarning(
            "Skipping unavailable Relay while listing CLI servers",
            error
          ).pipe(
            Effect.annotateLogs({
              "kiln.error_code": error.code,
              "kiln.relay_id": relayId,
            }),
            Effect.as(Option.none<TSnapshot>())
          )
        )
      ),
    { concurrency: 4 }
  )
  return snapshots.filter(Option.isSome).map((snapshot) => snapshot.value)
})

export const listCliServersEffect = Effect.fn("cli.api.servers.list")(
  function* (principal: CliPrincipal) {
    const relays = (yield* listPersistedRelaysEffect()).filter(
      (relay) => relay.enabled
    )
    const availableSnapshots = yield* collectAvailableCliRelaySnapshotsEffect(
      relays.map((relay) => ({
        relayId: relay.id,
        snapshot: relayRpcEffect(relay, "relay.snapshot", {}, principal).pipe(
          Effect.flatMap((value) => parseRelaySnapshot(value)),
          Effect.map((snapshot) => ({ relay, snapshot }))
        ),
      }))
    )
    const snapshots = yield* Effect.forEach(
      availableSnapshots,
      ({ relay, snapshot }) =>
        allowedInstanceIdsEffect(
          principal.user,
          relay.id,
          snapshot.instances.map((instance) => instance.id)
        ).pipe(
          Effect.map((allowed) => ({
            instances: snapshot.instances.filter((instance) =>
              allowed.has(instance.id)
            ),
            relay,
          }))
        ),
      { concurrency: 4 }
    )
    return {
      servers: snapshots.flatMap(({ instances, relay }) =>
        instances.map((instance) =>
          cliServerSchema.parse({
            id: `${relay.id}:${instance.id}`,
            instanceId: instance.id,
            name: instance.name,
            relayId: relay.id,
            relayName: relay.name,
            shortId: instance.shortId,
            state: instance.observedState,
          })
        )
      ),
    }
  }
)

export const listCliRelaysEffect = Effect.fn("cli.api.relays.list")(function* (
  principal: CliPrincipal
) {
  const relays = (yield* listPersistedRelaysEffect()).filter(
    (relay) => relay.enabled
  )
  const visibleRelayIds = isPlatformAdmin(principal.user)
    ? new Set(relays.map((relay) => relay.id))
    : new Set(
        (yield* listUserGrantsEffect(principal.user.id)).flatMap((grant) =>
          grant.resourceType === "relay" &&
          roleHasPermission(grant.role, "relay.read")
            ? [grant.relayId]
            : []
        )
      )
  const visible = relays.filter((relay) => visibleRelayIds.has(relay.id))
  const snapshots = yield* Effect.forEach(
    visible,
    (relay) =>
      relayRpcEffect(relay, "relay.snapshot", {}, principal).pipe(
        Effect.flatMap(parseRelaySnapshot),
        Effect.map(Option.some),
        Effect.catchTag("CliAccessError", () =>
          Effect.succeed(Option.none<z.infer<typeof relaySnapshotSchema>>())
        ),
        Effect.map((snapshot) => ({ relay, snapshot }))
      ),
    { concurrency: 4 }
  )
  return cliRelaysResponseSchema.parse({
    relays: snapshots.map(({ relay, snapshot }) =>
      cliRelaySummary(relay, Option.getOrNull(snapshot))
    ),
  })
})

export const getCliRelayInfoEffect = Effect.fn("cli.api.relays.info")(
  function* (principal: CliPrincipal, relayId: string) {
    const relay = yield* authorizeRelay(principal, relayId, "relay.read")
    const snapshot = yield* relayRpcEffect(
      relay,
      "relay.snapshot",
      {},
      principal
    ).pipe(Effect.flatMap(parseRelaySnapshot))
    return cliRelayInfoResponseSchema.parse({
      relay: cliRelaySummary(relay, snapshot),
      node: {
        connectedAt: snapshot.node.connectedAt,
        cpuCores: snapshot.node.cpu.cores,
        cpuLoadPercent: snapshot.node.cpu.loadPercent,
        id: snapshot.node.id,
        memory: snapshot.node.memory,
        name: snapshot.node.name,
        startedAt: snapshot.node.startedAt,
        storage: snapshot.node.storage,
        uptimeSeconds: snapshot.node.uptimeSeconds,
      },
    })
  }
)

export const getCliServerInfoEffect = Effect.fn("cli.api.servers.info")(
  function* (
    principal: CliPrincipal,
    input: { instanceId: string; relayId: string }
  ) {
    const { instance, relay } = yield* loadAuthorizedInstance(
      principal,
      input,
      "instance.read"
    )
    return cliServerInfoResponseSchema.parse({
      relay: { id: relay.id, name: relay.name },
      server: cliServerMetadata(instance),
    })
  }
)

export const listCliActivityEffect = Effect.fn("cli.api.activity.list")(
  function* (principal: CliPrincipal, limit: number) {
    const activity = yield* Effect.tryPromise({
      try: () => getActivityForUser(principal.user, { limit }),
      catch: (cause) =>
        CliAccessError.make({
          code: "unexpected_error",
          message: "Hearth could not load activity.",
          retryable: false,
          cause,
        }),
    })
    return cliActivityResponse(activity.entries, limit)
  }
)

export const createCliServerEffect = Effect.fn("cli.api.servers.create")(
  function* (principal: CliPrincipal, unknownInput: unknown) {
    yield* requireCliWrite(principal)
    if (!isPlatformAdmin(principal.user)) {
      return yield* forbidden(
        "Platform administrator access is required to create servers."
      )
    }
    const input = yield* parseInput(cliCreateServerRequestSchema, unknownInput)
    const relay = yield* requiredRelay(input.relayId)
    const recipe = yield* resolveBrickSource(relay, input.brick, principal)
    const result = yield* relayRpcEffect(
      relay,
      "instance.create",
      {
        diskLimitBytes: input.diskLimitBytes,
        name: input.name,
        recipe,
        start: input.start,
        variables: input.variables,
      },
      principal,
      360_000
    )
    const instance = relayInstanceSchema.parse(result)
    yield* invalidateRelayCache(relayCachePolicy.snapshot(relay.id))
    yield* Effect.tryPromise({
      try: () => provisionInstanceDomainBestEffort(instance, relay.id),
      catch: () => undefined,
    })
    return cliServerMutationResponseSchema.parse({
      relayId: relay.id,
      server: cliServerMetadata(instance),
    })
  }
)

export const updateCliServerStartupEffect = Effect.fn(
  "cli.api.servers.startup.update"
)(function* (principal: CliPrincipal, unknownInput: unknown) {
  yield* requireCliWrite(principal)
  const input = yield* parseInput(
    cliUpdateServerStartupRequestSchema,
    unknownInput
  )
  const { instance, relay } = yield* loadAuthorizedInstance(
    principal,
    input,
    "instance.settings"
  )
  const recipe = input.brick
    ? yield* resolveBrickSource(relay, input.brick, principal)
    : undefined
  const variables = recipe
    ? input.variables
    : { ...instance.variables, ...input.variables }
  const result = yield* relayRpcEffect(
    relay,
    "instance.startup.write",
    {
      ...(input.diskLimitBytes === undefined
        ? {}
        : { diskLimitBytes: input.diskLimitBytes }),
      instanceId: instance.id,
      ...(recipe ? { recipe } : {}),
      start: input.start,
      variables,
    },
    principal,
    360_000
  )
  const updated = relayInstanceSchema.parse(result)
  yield* invalidateRelayCache(relayCachePolicy.snapshot(relay.id))
  yield* Effect.tryPromise({
    try: () => provisionInstanceDomainBestEffort(updated, relay.id),
    catch: () => undefined,
  })
  return cliServerMutationResponseSchema.parse({
    relayId: relay.id,
    server: cliServerMetadata(updated),
  })
})

export const deleteCliServerEffect = Effect.fn("cli.api.servers.delete")(
  function* (principal: CliPrincipal, unknownInput: unknown) {
    yield* requireCliWrite(principal)
    const input = yield* parseInput(cliDeleteServerRequestSchema, unknownInput)
    if (input.confirmation !== `${input.relayId}:${input.instanceId}`) {
      return yield* forbidden(
        "The server confirmation did not match the requested server."
      )
    }
    const relay = yield* authorizeTarget(principal, input, "instance.delete")
    yield* deleteInstanceDomainEffect(relay.id, input.instanceId)
    const result = yield* relayRpcEffect(
      relay,
      "instance.delete",
      { deleteData: true, instanceId: input.instanceId },
      principal,
      360_000
    )
    const deleted = z
      .object({ deleted: z.literal(true), instanceId: z.string() })
      .parse(result)
    yield* finalizeInstanceDeletionEffect(relay.id, input.instanceId)
    return { ...deleted, relayId: relay.id }
  }
)

export const uploadCliFileFromUrlEffect = Effect.fn("cli.api.files.uploadUrl")(
  function* (principal: CliPrincipal, unknownInput: unknown) {
    yield* requireCliWrite(principal)
    const input = yield* parseInput(
      cliRemoteFileUploadRequestSchema,
      unknownInput
    )
    const relay = yield* authorizeTarget(
      principal,
      input,
      "instance.files.write"
    )
    const result = yield* relayRpcEffect(
      relay,
      "instance.files.upload-url",
      relayRemoteUploadInput(input),
      principal,
      360_000
    )
    const uploaded = cliRemoteFileUploadResponseSchema.parse(
      relayRemoteFileUploadResultSchema.parse(result)
    )
    yield* invalidateRelayCache(
      relayCachePolicy.tree(relay.id, input.instanceId)
    )
    return uploaded
  }
)

export function cliActivityResponse(
  entries: ReadonlyArray<Readonly<Record<string, unknown>>>,
  limit: number
) {
  const safeEntries = entries.slice(0, limit).map((entry) => {
    const { rawEvent, ...safeEntry } = entry
    void rawEvent
    return safeEntry
  })
  return cliActivityResponseSchema.parse({ entries: safeEntries })
}

export function relayRemoteUploadInput(
  input: z.infer<typeof cliRemoteFileUploadRequestSchema>
) {
  return relayRemoteFileUploadSchema.parse({
    instanceId: input.instanceId,
    path: input.path,
    url: input.url,
  })
}

export const performCliPowerActionEffect = Effect.fn("cli.api.power")(
  function* (principal: CliPrincipal, unknownInput: unknown) {
    yield* requireCliWrite(principal)
    const input = yield* parseInput(cliPowerRequestSchema, unknownInput)
    const relay = yield* authorizeTarget(principal, input, "instance.power")
    const result = yield* relayRpcEffect(
      relay,
      "instance.action",
      { action: input.action, instanceId: input.instanceId },
      principal,
      CLI_RELAY_LONG_OPERATION_TIMEOUT_MS
    )
    return {
      instance: relayInstanceSchema.parse(result),
      relayId: relay.id,
    }
  }
)

export const sendCliConsoleCommandEffect = Effect.fn("cli.api.console.write")(
  function* (
    principal: CliPrincipal,
    input: { command: string; instanceId: string; relayId: string }
  ) {
    yield* requireCliWrite(principal)
    const relay = yield* authorizeTarget(
      principal,
      input,
      "instance.console.write"
    )
    const result = yield* relayRpcEffect(
      relay,
      "instance.console.write",
      { command: input.command, instanceId: input.instanceId },
      principal
    )
    return relayConsoleCommandResultSchema.parse(result)
  }
)

export const getCliConsoleHistoryEffect = Effect.fn("cli.api.console.history")(
  function* (
    principal: CliPrincipal,
    input: { instanceId: string; limit: number; relayId: string }
  ) {
    const relay = yield* authorizeTarget(
      principal,
      input,
      "instance.console.read"
    )
    const result = yield* relayRpcEffect(
      relay,
      "instance.console.history",
      { instanceId: input.instanceId, limit: input.limit },
      principal
    )
    return relayConsoleSchema.parse(result)
  }
)

export const authorizeCliConsoleStreamEffect = Effect.fn(
  "cli.api.console.stream.authorize"
)(function* (
  principal: CliPrincipal,
  input: { instanceId: string; relayId: string }
) {
  yield* authorizeTarget(principal, input, "instance.console.read")
})

export const getCliFileTreeEffect = Effect.fn("cli.api.files.list")(function* (
  principal: CliPrincipal,
  unknownInput: unknown
) {
  const input = yield* parseInput(cliFileTargetSchema, unknownInput)
  const relay = yield* authorizeTarget(principal, input, "instance.files.read")
  const result = yield* relayRpcEffect(
    relay,
    "instance.files.list",
    { instanceId: input.instanceId },
    principal
  )
  const tree = relayFileTreeSchema.parse(result)
  const prefix = input.path === "." ? "" : input.path.replace(/\/$/u, "")
  return {
    ...tree,
    paths: prefix
      ? tree.paths.filter(
          (path) => path === prefix || path.startsWith(`${prefix}/`)
        )
      : tree.paths,
  }
})

export const readCliFileEffect = Effect.fn("cli.api.files.read")(function* (
  principal: CliPrincipal,
  unknownInput: unknown
) {
  const input = yield* parseInput(cliFileTargetSchema, unknownInput)
  const relay = yield* authorizeTarget(principal, input, "instance.files.read")
  const result = yield* relayRpcEffect(
    relay,
    "instance.files.read",
    { instanceId: input.instanceId, path: input.path },
    principal
  )
  return relayFileContentSchema.parse(result)
})

export const writeCliFileEffect = Effect.fn("cli.api.files.write")(function* (
  principal: CliPrincipal,
  unknownInput: unknown
) {
  yield* requireCliWrite(principal)
  const input = yield* parseInput(cliFileWriteRequestSchema, unknownInput)
  const relay = yield* authorizeTarget(principal, input, "instance.files.write")
  const result = yield* relayRpcEffect(
    relay,
    "instance.files.write",
    {
      content: input.content,
      expectedModifiedAt: input.expectedModifiedAt,
      instanceId: input.instanceId,
      path: input.path,
    },
    principal,
    CLI_RELAY_LONG_OPERATION_TIMEOUT_MS
  )
  return relayFileContentSchema.parse(result)
})

export const getCliSftpConnectionEffect = Effect.fn("cli.api.sftp")(function* (
  principal: CliPrincipal,
  input: { instanceId: string; relayId: string }
) {
  const relay = yield* authorizeTarget(
    principal,
    input,
    "instance.sftp.connect"
  )
  const value = yield* relayRpcEffect(relay, "relay.snapshot", {}, principal)
  const snapshot = yield* parseRelaySnapshot(value)
  const exists = snapshot.instances.some(
    (instance) => instance.id === input.instanceId
  )
  if (!exists || !snapshot.relay?.sftp) {
    return yield* CliAccessError.make({
      code: "sftp_unavailable",
      message: "SFTP is not configured for this server's Relay.",
      retryable: false,
    })
  }
  return cliSftpConnectionResponse(
    snapshot.relay.sftp,
    input.instanceId,
    principal.user.email
  )
})

export function cliSftpConnectionResponse(
  connection: RelaySftpConnection,
  instanceId: string,
  username: string
) {
  return cliSftpResponseSchema.parse({
    host: connection.host,
    hostKeyFingerprint: connection.hostKeyFingerprint,
    port: connection.port,
    root: `/${instanceId}`,
    username,
  })
}

const authorizeTarget = Effect.fn("cli.api.target.authorize")(function* (
  principal: CliPrincipal,
  input: { instanceId: string; relayId: string },
  permission: AccessPermission
) {
  const relay = yield* requiredRelay(input.relayId)
  yield* requireRelayPermissionEffect({
    instanceId: input.instanceId,
    permission,
    relayId: relay.id,
    user: principal.user,
  }).pipe(
    Effect.catchTag("PermissionDeniedError", (cause) =>
      CliAccessError.make({
        code: "forbidden",
        message: cause.message,
        retryable: false,
      })
    )
  )
  return relay
})

const authorizeRelay = Effect.fn("cli.api.relay.authorize")(function* (
  principal: CliPrincipal,
  relayId: string,
  permission: AccessPermission
) {
  const relay = yield* requiredRelay(relayId)
  yield* requireRelayPermissionEffect({
    permission,
    relayId: relay.id,
    user: principal.user,
  }).pipe(
    Effect.catchTag("PermissionDeniedError", (cause) =>
      CliAccessError.make({
        code: "forbidden",
        message: cause.message,
        retryable: false,
      })
    )
  )
  return relay
})

const requiredRelay = Effect.fn("cli.api.relay.required")(function* (
  relayId: string
) {
  const relays = yield* listPersistedRelaysEffect()
  const relay = relays.find(
    (candidate) => candidate.enabled && candidate.id === relayId
  )
  if (!relay) {
    return yield* CliAccessError.make({
      code: "not_found",
      message: "The requested Relay was not found.",
      retryable: false,
    })
  }
  return relay
})

const loadAuthorizedInstance = Effect.fn("cli.api.instance.load")(function* (
  principal: CliPrincipal,
  input: { instanceId: string; relayId: string },
  permission: AccessPermission
) {
  const relay = yield* authorizeTarget(principal, input, permission)
  const snapshot = yield* relayRpcEffect(
    relay,
    "relay.snapshot",
    {},
    principal
  ).pipe(Effect.flatMap(parseRelaySnapshot))
  const instance = snapshot.instances.find(
    (candidate) => candidate.id === input.instanceId
  )
  if (!instance) {
    return yield* CliAccessError.make({
      code: "not_found",
      message: "The requested server was not found.",
      retryable: false,
    })
  }
  return { instance, relay }
})

const resolveBrickSource = Effect.fn("cli.api.brick.resolve")(function* (
  relay: PersistedRelay,
  brick: string,
  principal: CliPrincipal
) {
  if (/^https:\/\//iu.test(brick)) return brick
  const catalogValue = yield* relayRpcEffect(
    relay,
    "brick.catalog",
    {},
    principal
  )
  const catalog = relayCatalogSchema.parse(catalogValue)
  const source = catalog.bricks.find(
    (candidate) => candidate.metadata.id === brick
  )?.source
  if (!source) {
    return yield* CliAccessError.make({
      code: "not_found",
      message: `Brick ${brick} is not available on this Relay.`,
      retryable: false,
    })
  }
  return source
})

function cliRelaySummary(
  relay: PersistedRelay,
  snapshot: z.infer<typeof relaySnapshotSchema> | null
) {
  return cliRelaySchema.parse({
    arch: snapshot?.node.arch ?? relay.nodeArch,
    canProvisionServers: snapshot?.node.canProvisionInstances ?? null,
    id: relay.id,
    name: relay.name,
    platform: snapshot?.node.platform ?? relay.nodePlatform,
    serverCount: snapshot?.instances.length ?? null,
    status: snapshot ? "connected" : "unreachable",
    version: snapshot?.node.version ?? relay.nodeVersion,
  })
}

function cliServerMetadata(instance: z.infer<typeof relayInstanceSchema>) {
  return {
    brickId: instance.brickId ?? null,
    brickSource: safeCliBrickSource(instance.brickSource),
    connectAddress: instance.connectAddress,
    desiredState: instance.desiredState,
    diskLimitBytes: instance.limits.diskBytes,
    game: instance.game,
    id: instance.id,
    implementation: instance.implementation,
    javaVersion: instance.javaVersion,
    memoryLimitBytes: instance.limits.memoryBytes,
    name: instance.name,
    observedState: instance.observedState,
    publicAddress:
      instance.publicHost && instance.publicPort
        ? `${instance.publicHost}:${instance.publicPort}`
        : null,
    readyAt: instance.readyAt,
    resources: instance.resources
      ? {
          cpuPercent: instance.resources.cpu.percent,
          memoryUsedBytes: instance.resources.memory.usedBytes,
          networkReceivedBytes:
            instance.resources.network?.receivedBytes ?? null,
          networkSentBytes: instance.resources.network?.sentBytes ?? null,
          sampledAt: instance.resources.sampledAt,
          storageUsedBytes: instance.resources.storage.usedBytes,
        }
      : null,
    shortId: instance.shortId,
    startedAt: instance.startedAt,
    version: instance.version,
  }
}

export function safeCliBrickSource(source: string | undefined): string | null {
  if (!source) return null
  return Result.try(() => {
    const url = new URL(source)
    url.username = ""
    url.password = ""
    url.search = ""
    url.hash = ""
    return url.href
  }).pipe(Result.getOrNull)
}

function forbidden(message: string) {
  return CliAccessError.make({
    code: "forbidden",
    message,
    retryable: false,
  })
}

function relayRpcEffect(
  relay: PersistedRelay,
  operation: Parameters<typeof relayRpc>[1],
  payload: unknown,
  principal: CliPrincipal,
  timeoutMs?: number
) {
  return Effect.tryPromise({
    try: () =>
      relayRpc(
        relay,
        operation,
        payload,
        timeoutMs,
        cliRelaySubject(principal)
      ),
    catch: (cause) =>
      CliAccessError.make({
        code: "relay_unavailable",
        message:
          cause instanceof Error
            ? cause.message
            : "Hearth could not reach the Relay.",
        retryable: true,
        cause,
      }),
  })
}

function parseRelaySnapshot(value: unknown) {
  return Effect.try({
    try: () => relaySnapshotSchema.parse(value),
    catch: (cause) =>
      CliAccessError.make({
        code: "relay_unavailable",
        message: "The Relay returned an invalid snapshot.",
        retryable: true,
        cause,
      }),
  })
}

function parseInput<TValue>(schema: z.ZodType<TValue>, value: unknown) {
  return Effect.try({
    try: () => schema.parse(value),
    catch: (cause) =>
      CliAccessError.make({
        code: "invalid_request",
        message: "The CLI request contains invalid input.",
        retryable: false,
        cause,
      }),
  })
}
