import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"
import {
  relayConsoleCommandResultSchema,
  relayConsoleCommandSchema,
  relayConsoleCompletionInputSchema,
  relayConsoleCompletionSchema,
  relayConsoleSchema,
  relayFileActivitySchema,
  relayFileContentSchema,
  relayFileTreeSchema,
  relayInstanceActionSchema,
  relayInstanceSchema,
  relayLatestLogSchema,
  relaySaveFileInputSchema,
  relaySnapshotSchema,
} from "@workspace/contracts"
import { z } from "zod"

import {
  allowedInstanceIds,
  requireRelayPermission,
} from "@/lib/access-control"
import {
  applyInstanceDisplayNames,
  saveInstanceDisplayName,
} from "@/lib/instance-registry"
import {
  listFileActivity,
  recordFileEdited,
  recordFileViewed,
  setFilePinned,
} from "@/lib/file-activity"
import type { AccessPermission } from "@/lib/permissions"
import type { AuthenticatedUser } from "@/lib/auth-session"
import { requireAuthenticatedUser } from "@/server/auth"
import {
  AuthenticationError,
  ExternalServiceError,
  ResourceNotFoundError,
} from "@/effect/errors"
import { runAppEffect } from "@/effect/runtime"
import {
  cachedRelayFallbackJsonEffect,
  cachedRelayJsonEffect,
  invalidateRelayCache,
  relayCachePolicy,
  relayFetchEffect,
  relayJsonEffect,
} from "@/lib/relay-client"
import type { RelayEndpoint } from "@/lib/relay-client"
import {
  relayInstanceRouteId,
  type RelayFleetSnapshot,
  type RelayReachability,
} from "@/lib/relay-fleet"
import type { PersistedRelay } from "@/lib/relay-registry"
import { listPersistedRelays } from "@/lib/relay-registry"
import { resolveMclogsApiUrl } from "@/lib/mclogs"

const instanceInputSchema = z.object({
  instanceId: z.string().min(1),
  relayId: z.uuid(),
})

const treeInputSchema = instanceInputSchema.extend({
  fresh: z.boolean().optional(),
})

const instanceNameInputSchema = instanceInputSchema.extend({
  name: z.string().trim().min(1).max(120),
})

const liveConsoleInputSchema = instanceInputSchema.extend({
  requestedAt: z.number(),
})

const filePathSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine(
    (path) =>
      !path.includes("\0") &&
      !path.startsWith("/") &&
      !path.split(/[\\/]/u).includes(".."),
    "Invalid relative file path"
  )

const fileInputSchema = instanceInputSchema.extend({ path: filePathSchema })

const filePinInputSchema = fileInputSchema.extend({ pinned: z.boolean() })

const saveFileInputSchema = fileInputSchema.extend(
  relaySaveFileInputSchema.shape
)

const actionInputSchema = instanceInputSchema.extend(
  relayInstanceActionSchema.shape
)

const consoleCommandInputSchema = instanceInputSchema.extend(
  relayConsoleCommandSchema.shape
)

const consoleCompletionInputSchema = instanceInputSchema.extend(
  relayConsoleCompletionInputSchema.shape
)

const consoleShareInputSchema = instanceInputSchema.extend({
  implementation: z.string().min(1),
  version: z.string().min(1),
  redactSensitive: z.boolean().default(false),
})

const mclogsUploadInputSchema = instanceInputSchema.extend({
  content: z
    .string()
    .min(1)
    .max(10 * 1024 * 1024),
  path: z.string().min(1),
  implementation: z.string().min(1),
  version: z.string().min(1),
})

const mclogsResponseSchema = z.object({
  success: z.literal(true),
  id: z.string(),
  url: z.url(),
  expires: z.number().int(),
})

const relayWarningIntervalMs = 60_000
const relayWarningAt = new Map<string, number>()

export const getRelaySnapshot = createServerFn({ method: "POST" }).handler(
  async () => {
    const user = await requireAuthenticatedUser()
    return authorizedFleetSnapshot(user, true)
  }
)

export const getRelayConnectionState = createServerFn({
  method: "GET",
}).handler(async () => {
  const user = await requireAuthenticatedUser()
  const configuredRelays = await listPersistedRelays()

  if (configuredRelays.length === 0) {
    return {
      status: "unconfigured" as const,
      message: "No Relay has been configured yet.",
      relay: null,
    }
  }

  const relays = configuredRelays.filter((relay) => relay.enabled)
  if (relays.length === 0) {
    return {
      status: "paused" as const,
      message: "All configured Relays are paused.",
      relay: publicFleetRelay(configuredRelays, 0),
      relays: configuredRelays.map((relay) =>
        publicRelayState({ relay, status: "paused" })
      ),
    }
  }

  const entries = await Promise.all(
    relays.map((relay) =>
      authorizedRelayEntry(relay, user, {
        fallbackOnError: true,
        warnOnUnavailable: true,
      })
    )
  )
  const connectedCount = entries.filter(
    (entry) => entry.status === "connected"
  ).length
  const snapshot = mergeRelaySnapshots(entries)
  const relay = publicFleetRelay(relays, connectedCount)
  if (connectedCount === 0) {
    return {
      status: "unreachable" as const,
      message:
        relays.length === 1
          ? "The Relay is configured, but Hearth cannot reach it right now."
          : "Hearth cannot reach any configured Relay right now.",
      relay,
      relays: entries.map(publicRelayState),
    }
  }
  return {
    status: "connected" as const,
    relay,
    relays: entries.map(publicRelayState),
    snapshot,
  }
})

function warnRelayUnavailable(relayId: string, cause: unknown) {
  const now = Date.now()
  const lastWarning = relayWarningAt.get(relayId) ?? 0
  if (now - lastWarning < relayWarningIntervalMs) return
  relayWarningAt.set(relayId, now)
  console.warn(`[Kiln Relay] Could not reach Relay ${relayId}:`, cause)
}

export const updateInstanceName = createServerFn({ method: "POST" })
  .validator(instanceNameInputSchema)
  .handler(async ({ data }) => {
    const { relay, user } = await instanceRelayAccess(data.relayId)
    await requireRelayPermission({
      user,
      relayId: relay.id,
      permission: "instance.settings",
      instanceId: data.instanceId,
    })
    const snapshot = relaySnapshotSchema.parse(
      await relayRequestRaw(relay, "/v1/snapshot")
    )
    const instance = snapshot.instances.find(
      (item) => item.id === data.instanceId
    )
    if (!instance) throw new Error("Instance not found")

    await saveInstanceDisplayName(relay.id, instance.id, data.name)
    return {
      ...relayInstanceSchema.parse({ ...instance, name: data.name }),
      relayId: relay.id,
    }
  })

export const getRelayTree = createServerFn({ method: "GET" })
  .validator(treeInputSchema)
  .handler(async ({ data }) => {
    const { relay, user } = await instanceRelayAccess(data.relayId)
    await requireRelayPermission({
      user,
      relayId: relay.id,
      permission: "instance.files.read",
      instanceId: data.instanceId,
    })
    return runAppEffect(
      "relay.tree",
      cachedRelayJsonEffect({
        bypass: data.fresh,
        decode: relayFileTreeSchema.parse,
        fallbackOnError: !data.fresh,
        path: `/v1/instances/${encodeURIComponent(data.instanceId)}/tree`,
        policy: relayCachePolicy.tree(relay.id, data.instanceId),
        relay,
      })
    )
  })

export const getRelayFile = createServerFn({ method: "GET" })
  .validator(fileInputSchema)
  .handler(async ({ data }) => {
    const { relay, user } = await instanceRelayAccess(data.relayId)
    await requireRelayPermission({
      user,
      relayId: relay.id,
      permission: "instance.files.read",
      instanceId: data.instanceId,
    })
    const response = await relayFetch(
      relay,
      `/v1/instances/${encodeURIComponent(data.instanceId)}/file?path=${encodeURIComponent(data.path)}`
    )
    const file = relayFileContentSchema.parse(await response.json())
    await recordFileActivityBestEffort(
      "view",
      recordFileViewed(relay.id, data.instanceId, data.path)
    )
    return file
  })

export const saveRelayFile = createServerFn({ method: "POST" })
  .validator(saveFileInputSchema)
  .handler(async ({ data }) => {
    const { instanceId, path, relayId, ...input } = data
    const { relay, user } = await instanceRelayAccess(relayId)
    await requireRelayPermission({
      user,
      relayId: relay.id,
      permission: "instance.files.write",
      instanceId,
    })
    const response = await relayFetch(
      relay,
      `/v1/instances/${encodeURIComponent(instanceId)}/file?path=${encodeURIComponent(path)}`,
      { method: "PUT", body: JSON.stringify(input) }
    )
    const file = relayFileContentSchema.parse(await response.json())
    await recordFileActivityBestEffort(
      "edit",
      recordFileEdited(relay.id, instanceId, path)
    )
    return file
  })

export const getRelayFileActivity = createServerFn({ method: "GET" })
  .validator(instanceInputSchema)
  .handler(async ({ data }) => {
    const { relay, user } = await instanceRelayAccess(data.relayId)
    await requireRelayPermission({
      user,
      relayId: relay.id,
      permission: "instance.files.read",
      instanceId: data.instanceId,
    })
    return relayFileActivitySchema.parse(
      await listFileActivity(relay.id, data.instanceId)
    )
  })

export const updateRelayFilePin = createServerFn({ method: "POST" })
  .validator(filePinInputSchema)
  .handler(async ({ data }) => {
    const { relay, user } = await instanceRelayAccess(data.relayId)
    await requireRelayPermission({
      user,
      relayId: relay.id,
      permission: "instance.files.write",
      instanceId: data.instanceId,
    })
    const tree = await runAppEffect(
      "relay.tree.pinValidation",
      cachedRelayJsonEffect({
        decode: relayFileTreeSchema.parse,
        path: `/v1/instances/${encodeURIComponent(data.instanceId)}/tree`,
        policy: relayCachePolicy.tree(relay.id, data.instanceId),
        relay,
      })
    )
    if (!tree.paths.includes(data.path) || data.path.endsWith("/")) {
      throw new Error("File not found")
    }
    return relayFileActivitySchema.parse(
      await setFilePinned(
        relay.id,
        data.instanceId,
        data.path,
        data.pinned,
        new Set(tree.paths)
      )
    )
  })

export const performRelayAction = createServerFn({ method: "POST" })
  .validator(actionInputSchema)
  .handler(async ({ data }) => {
    const { instanceId, action } = data
    const { relay, user } = await instanceRelayAccess(data.relayId)
    await requireRelayPermission({
      user,
      relayId: relay.id,
      permission: "instance.power",
      instanceId,
    })
    const response = await relayFetch(
      relay,
      `/v1/instances/${encodeURIComponent(instanceId)}/actions`,
      { method: "POST", body: JSON.stringify({ action }) }
    )
    const instance = relayInstanceSchema.parse(await response.json())
    await runAppEffect(
      "relay.snapshot.invalidate",
      invalidateRelayCache(relayCachePolicy.snapshot(relay.id))
    )
    const [displayInstance] = await applyInstanceDisplayNames(relay.id, [
      instance,
    ])
    return { ...displayInstance, relayId: relay.id }
  })

export const getRelayConsole = createServerFn({ method: "POST" })
  .validator(liveConsoleInputSchema)
  .handler(async ({ data }) =>
    relayConsoleSchema.parse(
      await relayRequest(
        `/v1/instances/${encodeURIComponent(data.instanceId)}/console?limit=3000`,
        undefined,
        "instance.console.read",
        data.instanceId,
        data.relayId
      )
    )
  )

export const sendRelayCommand = createServerFn({ method: "POST" })
  .validator(consoleCommandInputSchema)
  .handler(async ({ data }) =>
    relayConsoleCommandResultSchema.parse(
      await relayRequest(
        `/v1/instances/${encodeURIComponent(data.instanceId)}/console`,
        { method: "POST", body: JSON.stringify({ command: data.command }) },
        "instance.console.write",
        data.instanceId,
        data.relayId
      )
    )
  )

export const completeRelayCommand = createServerFn({ method: "POST" })
  .validator(consoleCompletionInputSchema)
  .handler(async ({ data }) =>
    relayConsoleCompletionSchema.parse(
      await relayRequest(
        `/v1/instances/${encodeURIComponent(data.instanceId)}/console-completions`,
        {
          method: "POST",
          body: JSON.stringify({ input: data.input, cursor: data.cursor }),
        },
        "instance.console.write",
        data.instanceId,
        data.relayId
      )
    )
  )

export const uploadToMclogs = createServerFn({ method: "POST" })
  .validator(mclogsUploadInputSchema)
  .handler(async ({ data }) => {
    await authorize("instance.logs.share", data.instanceId, data.relayId)
    return uploadLog(data)
  })

export const uploadLatestLogToMclogs = createServerFn({ method: "POST" })
  .validator(consoleShareInputSchema)
  .handler(async ({ data }) => {
    const latest = relayLatestLogSchema.parse(
      await relayRequest(
        `/v1/instances/${encodeURIComponent(data.instanceId)}/latest-log`,
        undefined,
        "instance.logs.share",
        data.instanceId,
        data.relayId
      )
    )
    return uploadLog({
      ...data,
      content: data.redactSensitive
        ? redactSensitiveText(latest.content)
        : latest.content,
      path: latest.path,
    })
  })

function uploadLog(data: z.infer<typeof mclogsUploadInputSchema>) {
  return runAppEffect("mclogs.upload", uploadLogEffect(data))
}

const uploadLogEffect = Effect.fn("mclogs.upload")(function* (
  data: z.infer<typeof mclogsUploadInputSchema>
) {
  const endpoint = resolveMclogsApiUrl(process.env.MCLOGS_API_URL)
  const timeout = AbortSignal.timeout(20_000)
  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: data.content,
          source: "Kiln",
          metadata: [
            {
              key: "instance",
              label: "Instance",
              value: data.instanceId,
              visible: true,
            },
            {
              key: "software",
              label: "Software",
              value: `${data.implementation} ${data.version}`,
              visible: true,
            },
            {
              key: "path",
              label: "Source file",
              value: data.path,
              visible: true,
            },
          ],
        }),
        signal: timeout,
      }),
    catch: (cause) =>
      ExternalServiceError.make({
        service: "mclo.gs",
        message: timeout.aborted
          ? "mclo.gs upload timed out after 20 seconds"
          : `Could not upload to mclo.gs: ${errorMessage(cause)}`,
        cause,
      }),
  })

  const payload = yield* Effect.promise(() => response.json().catch(() => null))
  const errorPayload = z
    .object({ error: z.string().optional() })
    .nullable()
    .safeParse(payload)
  const responseMessage = errorPayload.success
    ? errorPayload.data?.error
    : undefined

  if (!response.ok) {
    return yield* ExternalServiceError.make({
      service: "mclo.gs",
      message: responseMessage ?? `mclo.gs returned HTTP ${response.status}`,
    })
  }

  const result = mclogsResponseSchema.safeParse(payload)
  if (!result.success) {
    return yield* ExternalServiceError.make({
      service: "mclo.gs",
      message: responseMessage ?? "mclo.gs returned an invalid response",
    })
  }
  return {
    id: result.data.id,
    url: result.data.url,
    expires: result.data.expires,
  }
})

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

async function recordFileActivityBestEffort(
  kind: "edit" | "view",
  operation: Promise<void>
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    console.warn(
      `[Kiln Files] The ${kind} succeeded, but its recent-file activity could not be recorded:`,
      cause
    )
  }
}

async function relayRequest(
  path: string,
  init: RequestInit | undefined,
  permission: AccessPermission,
  instanceId: string,
  relayId: string
): Promise<unknown> {
  const { relay, user } = await instanceRelayAccess(relayId)
  await requireRelayPermission({
    user,
    relayId: relay.id,
    permission,
    instanceId,
  })
  const response = await relayFetch(relay, path, init)
  return response.json()
}

async function relayRequestRaw(
  relay: RelayEndpoint,
  path: string,
  init?: RequestInit
): Promise<unknown> {
  return runAppEffect(
    "relay.json",
    relayJsonEffect(relay, path, (input) => input, init)
  )
}

async function relaySnapshot(relay: RelayEndpoint) {
  return runAppEffect(
    "relay.snapshot",
    cachedRelayJsonEffect({
      decode: relaySnapshotSchema.parse,
      path: "/v1/snapshot",
      policy: relayCachePolicy.snapshot(relay.id),
      relay,
    })
  )
}

async function relayFallbackSnapshot(relay: RelayEndpoint) {
  return runAppEffect(
    "relay.snapshotFallback",
    cachedRelayFallbackJsonEffect({
      decode: relaySnapshotSchema.parse,
      policy: relayCachePolicy.snapshot(relay.id),
    })
  )
}

async function authorizeRelaySnapshot(
  snapshot: Awaited<ReturnType<typeof relaySnapshot>>,
  relay: RelayEndpoint,
  user: AuthenticatedUser
) {
  const allowed = await allowedInstanceIds(
    user,
    relay.id,
    snapshot.instances.map((instance) => instance.id)
  )
  const instances = snapshot.instances.filter((item) => allowed.has(item.id))
  return {
    ...snapshot,
    instances: await applyInstanceDisplayNames(relay.id, instances),
  }
}

async function authorizedRelayEntry(
  relay: PersistedRelay,
  user: AuthenticatedUser,
  options: { fallbackOnError: boolean; warnOnUnavailable: boolean }
) {
  let snapshot: Awaited<ReturnType<typeof relaySnapshot>> | null
  try {
    snapshot = await relaySnapshot(relay)
  } catch (cause) {
    if (!options.fallbackOnError) throw cause
    if (options.warnOnUnavailable) warnRelayUnavailable(relay.id, cause)
    snapshot =
      (await relayFallbackSnapshot(relay).catch(() => undefined)) ?? null
    return {
      relay,
      snapshot: snapshot
        ? await authorizeRelaySnapshot(snapshot, relay, user)
        : null,
      status: "unreachable" as const,
    }
  }

  return {
    relay,
    snapshot: await authorizeRelaySnapshot(snapshot, relay, user),
    status: "connected" as const,
  }
}

async function relayFetch(
  relay: RelayEndpoint,
  path: string,
  init?: RequestInit
): Promise<Response> {
  return runAppEffect("relay.fetch", relayFetchEffect(relay, path, init))
}

async function authorize(
  permission: AccessPermission,
  instanceId: string,
  relayId: string
) {
  const { relay, user } = await instanceRelayAccess(relayId)
  await requireRelayPermission({
    user,
    relayId: relay.id,
    permission,
    instanceId,
  })
}

async function instanceRelayAccess(relayId: string) {
  const user = await requireAuthenticatedUser().catch((cause) => {
    throw AuthenticationError.make({
      message: "Authentication required",
      cause,
    })
  })
  const relay = (await listPersistedRelays()).find(
    (item) => item.enabled && item.id === relayId
  )
  if (!relay) {
    throw ResourceNotFoundError.make({
      resource: "relay",
      message: "No Relay owns this instance",
    })
  }
  return { relay, user }
}

async function authorizedFleetSnapshot(
  user: AuthenticatedUser,
  fallbackOnError: boolean
): Promise<RelayFleetSnapshot> {
  const relays = (await listPersistedRelays()).filter((relay) => relay.enabled)
  const entries = await Promise.all(
    relays.map((relay) =>
      authorizedRelayEntry(relay, user, {
        fallbackOnError,
        warnOnUnavailable: false,
      })
    )
  )
  return mergeRelaySnapshots(entries)
}

function mergeRelaySnapshots(
  entries: Array<{
    relay: PersistedRelay
    snapshot: Awaited<ReturnType<typeof authorizeRelaySnapshot>> | null
    status: RelayReachability
  }>
): RelayFleetSnapshot {
  const instances = entries.flatMap(({ relay, snapshot, status }) =>
    (snapshot?.instances ?? []).map((instance) => ({
      ...instance,
      relayId: relay.id,
      relayName: relay.name,
      relayStatus: status,
    }))
  )
  return {
    nodes: entries.flatMap(({ relay, snapshot, status }) =>
      snapshot
        ? [
            {
              ...snapshot.node,
              relayId: relay.id,
              relayName: relay.name,
              relayStatus: status,
            },
          ]
        : []
    ),
    instances: instances.map((instance) => ({
      ...instance,
      routeId: relayInstanceRouteId(instance.relayId, instance.shortId),
    })),
  }
}

function publicFleetRelay(
  relays: Array<PersistedRelay>,
  connectedCount: number
) {
  const relay = relays[0]
  if (relays.length === 1 && relay) return { id: relay.id, name: relay.name }
  return {
    id: "relay-fleet",
    name: `${connectedCount}/${relays.length} Relays connected`,
  }
}

function publicRelayState<TStatus extends RelayReachability | "paused">(entry: {
  relay: PersistedRelay
  status: TStatus
}) {
  return {
    id: entry.relay.id,
    name: entry.relay.name,
    status: entry.status,
  }
}

function redactSensitiveText(value: string): string {
  return value
    .replace(
      /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/gu,
      (candidate) =>
        candidate
          .split(".")
          .map(() => "***")
          .join(".")
    )
    .replace(
      /(?<![\w:])(?:[a-f\d]{0,4}:){2,7}[a-f\d]{0,4}(?![\w:])/giu,
      (candidate) =>
        candidate.includes("::") || candidate.split(":").length - 1 >= 5
          ? candidate.replace(/[a-f\d]/giu, "*")
          : candidate
    )
}
