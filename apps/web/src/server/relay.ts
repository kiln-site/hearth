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
  cachedRelayJsonEffect,
  invalidateRelayCache,
  relayCachePolicy,
  relayFetchEffect,
  relayJsonEffect,
} from "@/lib/relay-client"
import type { RelayEndpoint } from "@/lib/relay-client"
import { resolvePrimaryRelayEffect } from "@/lib/relay-registry"
import { resolveMclogsApiUrl } from "@/lib/mclogs"

const instanceInputSchema = z.object({
  instanceId: z.string().min(1),
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

const mclogsUploadInputSchema = z.object({
  content: z
    .string()
    .min(1)
    .max(10 * 1024 * 1024),
  instanceId: z.string().min(1),
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
    const { relay, user } = await activeRelayAccess()
    return authorizedRelaySnapshot(relay, user)
  }
)

export const getRelayConnectionState = createServerFn({
  method: "GET",
}).handler(async () => {
  const user = await requireAuthenticatedUser()
  const { resolvePrimaryRelay } = await import("@/lib/relay-registry")
  const relay = await resolvePrimaryRelay()

  if (!relay) {
    return {
      status: "unconfigured" as const,
      message: "No Relay has been configured yet.",
      relay: null,
    }
  }

  const publicRelay = { id: relay.id, name: relay.name }
  try {
    return {
      status: "connected" as const,
      relay: publicRelay,
      snapshot: await authorizedRelaySnapshot(relay, user),
    }
  } catch (cause) {
    warnRelayUnavailable(relay.id, cause)
    return {
      status: "unreachable" as const,
      message:
        "The active Relay is configured, but Hearth cannot reach it right now.",
      relay: publicRelay,
    }
  }
})

function warnRelayUnavailable(relayId: string, cause: unknown) {
  const now = Date.now()
  const lastWarning = relayWarningAt.get(relayId) ?? 0
  if (now - lastWarning < relayWarningIntervalMs) return
  relayWarningAt.set(relayId, now)
  console.warn(`[Kiln Relay] Could not reach active Relay ${relayId}:`, cause)
}

export const updateInstanceName = createServerFn({ method: "POST" })
  .validator(instanceNameInputSchema)
  .handler(async ({ data }) => {
    const { relay, user } = await activeRelayAccess()
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
    return relayInstanceSchema.parse({ ...instance, name: data.name })
  })

export const getRelayTree = createServerFn({ method: "GET" })
  .validator(treeInputSchema)
  .handler(async ({ data }) => {
    const { relay, user } = await activeRelayAccess()
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
        path: `/v1/instances/${encodeURIComponent(data.instanceId)}/tree`,
        policy: relayCachePolicy.tree(relay.id, data.instanceId),
        relay,
      })
    )
  })

export const getRelayFile = createServerFn({ method: "GET" })
  .validator(fileInputSchema)
  .handler(async ({ data }) => {
    const { relay, user } = await activeRelayAccess()
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
    const { instanceId, path, ...input } = data
    const { relay, user } = await activeRelayAccess()
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
    const { relay, user } = await activeRelayAccess()
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
    const { relay, user } = await activeRelayAccess()
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
    const { relay, user } = await activeRelayAccess()
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
    return displayInstance
  })

export const getRelayConsole = createServerFn({ method: "POST" })
  .validator(liveConsoleInputSchema)
  .handler(async ({ data }) =>
    relayConsoleSchema.parse(
      await relayRequest(
        `/v1/instances/${encodeURIComponent(data.instanceId)}/console?limit=3000`,
        undefined,
        "instance.console.read",
        data.instanceId
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
        data.instanceId
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
        data.instanceId
      )
    )
  )

export const uploadToMclogs = createServerFn({ method: "POST" })
  .validator(mclogsUploadInputSchema)
  .handler(async ({ data }) => {
    await authorize("instance.logs.share", data.instanceId)
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
        data.instanceId
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
  instanceId?: string
): Promise<unknown> {
  const { relay, user } = await activeRelayAccess()
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

async function authorizedRelaySnapshot(
  relay: RelayEndpoint,
  user: AuthenticatedUser
) {
  const snapshot = await runAppEffect(
    "relay.snapshot",
    cachedRelayJsonEffect({
      decode: relaySnapshotSchema.parse,
      path: "/v1/snapshot",
      policy: relayCachePolicy.snapshot(relay.id),
      relay,
    })
  )
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

async function relayFetch(
  relay: RelayEndpoint,
  path: string,
  init?: RequestInit
): Promise<Response> {
  return runAppEffect("relay.fetch", relayFetchEffect(relay, path, init))
}

async function authorize(permission: AccessPermission, instanceId?: string) {
  const { relay, user } = await activeRelayAccess()
  await requireRelayPermission({
    user,
    relayId: relay.id,
    permission,
    instanceId,
  })
}

async function activeRelayAccess() {
  return runAppEffect("relay.activeAccess", activeRelayAccessEffect())
}

const activeRelayAccessEffect = Effect.fn("relay.activeAccess")(function* () {
  const user = yield* Effect.tryPromise({
    try: requireAuthenticatedUser,
    catch: (cause) =>
      AuthenticationError.make({ message: "Authentication required", cause }),
  })
  const relay = yield* resolvePrimaryRelayEffect()
  if (!relay) {
    return yield* ResourceNotFoundError.make({
      resource: "relay",
      message: "No active Relay is configured",
    })
  }
  return { relay, user }
})

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
