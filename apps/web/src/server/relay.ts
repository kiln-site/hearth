import { createServerFn } from "@tanstack/react-start"
import {
  relayConsoleCommandResultSchema,
  relayConsoleCommandSchema,
  relayConsoleCompletionInputSchema,
  relayConsoleCompletionSchema,
  relayConsoleSchema,
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
import type { AccessPermission } from "@/lib/permissions"
import type { AuthenticatedUser } from "@/lib/auth-session"
import { requireAuthenticatedUser } from "@/server/auth"

const instanceInputSchema = z.object({
  instanceId: z.string().min(1),
})

const instanceNameInputSchema = instanceInputSchema.extend({
  name: z.string().trim().min(1).max(120),
})

const liveConsoleInputSchema = instanceInputSchema.extend({
  requestedAt: z.number(),
})

const fileInputSchema = instanceInputSchema.extend({
  path: z.string().min(1),
})

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
  .validator(instanceInputSchema)
  .handler(async ({ data }) =>
    relayFileTreeSchema.parse(
      await relayRequest(
        `/v1/instances/${encodeURIComponent(data.instanceId)}/tree`,
        undefined,
        "instance.files.read",
        data.instanceId
      )
    )
  )

export const getRelayFile = createServerFn({ method: "GET" })
  .validator(fileInputSchema)
  .handler(async ({ data }) =>
    relayFileContentSchema.parse(
      await relayRequest(
        `/v1/instances/${encodeURIComponent(data.instanceId)}/file?path=${encodeURIComponent(data.path)}`,
        undefined,
        "instance.files.read",
        data.instanceId
      )
    )
  )

export const saveRelayFile = createServerFn({ method: "POST" })
  .validator(saveFileInputSchema)
  .handler(async ({ data }) => {
    const { instanceId, path, ...input } = data
    return relayFileContentSchema.parse(
      await relayRequest(
        `/v1/instances/${encodeURIComponent(instanceId)}/file?path=${encodeURIComponent(path)}`,
        { method: "PUT", body: JSON.stringify(input) },
        "instance.files.write",
        instanceId
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

async function uploadLog(data: z.infer<typeof mclogsUploadInputSchema>) {
  const endpoint = process.env.MCLOGS_API_URL ?? "https://api.mclo.gs/1/log"
  const response = await fetch(endpoint, {
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
    signal: AbortSignal.timeout(20_000),
  })

  const payload = (await response.json().catch(() => null)) as {
    error?: string
  } | null
  if (!response.ok || !payload) {
    throw new Error(
      payload?.error ?? `mclo.gs returned HTTP ${response.status}`
    )
  }

  const result = mclogsResponseSchema.safeParse(payload)
  if (!result.success) {
    throw new Error(payload.error ?? "mclo.gs returned an invalid response")
  }
  return {
    id: result.data.id,
    url: result.data.url,
    expires: result.data.expires,
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
  const response = await relayFetch(relay, path, init)
  return response.json()
}

async function authorizedRelaySnapshot(
  relay: RelayEndpoint,
  user: AuthenticatedUser
) {
  const snapshot = relaySnapshotSchema.parse(
    await relayRequestRaw(relay, "/v1/snapshot")
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
  const { relayHeaders } = await import("@/lib/relay-registry")
  const timeout = AbortSignal.timeout(10_000)
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout
  let response: Response
  try {
    response = await fetch(`${relayUrl(relay).replace(/\/$/u, "")}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(await relayHeaders(relay)),
        ...init?.headers,
      },
      signal,
    })
  } catch (cause) {
    if (timeout.aborted) throw new Error("Relay request timed out after 10s")
    throw new Error(
      cause instanceof Error
        ? `Could not reach Relay: ${cause.message}`
        : "Could not reach Relay"
    )
  }

  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(problem?.error ?? `Relay returned HTTP ${response.status}`)
  }

  return response
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
  const user = await requireAuthenticatedUser()
  const { resolvePrimaryRelay } = await import("@/lib/relay-registry")
  const relay = await resolvePrimaryRelay()
  if (!relay) throw new Error("No active Relay is configured")
  return { relay, user }
}

function relayUrl(relay: { hostname: string; port: number; useTls: boolean }) {
  return `${relay.useTls ? "https" : "http"}://${relay.hostname}:${relay.port}`
}

type RelayEndpoint = {
  hostname: string
  id: string
  port: number
  useTls: boolean
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
