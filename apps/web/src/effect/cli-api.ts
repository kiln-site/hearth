import type { CliPrincipal } from "@/effect/cli-access"
import {
  cliFileTargetSchema,
  cliFileWriteRequestSchema,
  cliPowerRequestSchema,
  cliServerSchema,
  cliSftpResponseSchema,
  relayConsoleCommandResultSchema,
  relayConsoleSchema,
  relayFileContentSchema,
  relayFileTreeSchema,
  relayInstanceSchema,
  relaySnapshotSchema,
} from "@workspace/contracts"
import { Effect, Option } from "effect"
import { z } from "zod"

import { cliRelaySubject, requireCliWrite } from "@/effect/cli-access"
import { CliAccessError } from "@/effect/errors"
import {
  allowedInstanceIdsEffect,
  requireRelayPermissionEffect,
} from "@/lib/access-control"
import type { AccessPermission } from "@/lib/permissions"
import { relayRpc } from "@/lib/relay-connection"
import {
  listPersistedRelaysEffect,
  type PersistedRelay,
} from "@/lib/relay-registry"

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
  const relays = yield* listPersistedRelaysEffect()
  const relay = relays.find(
    (candidate) => candidate.enabled && candidate.id === input.relayId
  )
  if (!relay) {
    return yield* CliAccessError.make({
      code: "not_found",
      message: "The requested Relay was not found.",
      retryable: false,
    })
  }
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
