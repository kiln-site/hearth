import { createServerFn, createServerOnlyFn } from "@tanstack/react-start"
import { z } from "zod"

import {
  kilnReleaseManifestEffect,
  listKilnReleasesEffect,
} from "@/effect/github-releases"
import { runAppEffect } from "@/effect/runtime"
import { isPlatformAdmin } from "@/lib/access-control"
import type { PersistedRelay } from "@/lib/relay-registry"
import { listPersistedRelays } from "@/lib/relay-registry"
import { validateUpdateManifest } from "@/lib/update-manifest"
import { requireAuthenticatedUser } from "@/server/auth"

const componentSchema = z.enum(["hearth", "relay"])
const startUpdateSchema = z.object({
  component: componentSchema,
  relayId: z.string().min(1).nullable(),
})
const updateStatusSchema = z.object({
  operationId: z.uuid(),
  relayId: z.string().min(1),
})
const systemInspectionSchema = z.object({
  component: componentSchema.nullable(),
  container: z.string().min(1),
  currentImage: z.string().min(1),
  currentVersion: z.string().nullable(),
  eligible: z.boolean(),
  reason: z.string().nullable(),
})
const updateOperationSchema = z.object({
  component: componentSchema,
  error: z.string().nullable(),
  finishedAt: z.string().nullable(),
  id: z.uuid(),
  previousImage: z.string(),
  requestedImage: z.string(),
  startedAt: z.string(),
  status: z.enum(["failed", "running", "succeeded"]),
  targetContainer: z.string(),
  version: z.string(),
})

const getContainerHostname = createServerOnlyFn(async () => {
  const { hostname } = await import("node:os")
  return hostname()
})

async function requirePlatformAdministrator(): Promise<void> {
  const user = await requireAuthenticatedUser()
  if (!isPlatformAdmin(user)) {
    throw new Error("Platform administrator access required")
  }
}

export const getUpdateOverview = createServerFn({ method: "GET" }).handler(
  async () => {
    await requirePlatformAdministrator()
    const [releases, relays, container] = await Promise.all([
      runAppEffect("updates.releases", listKilnReleasesEffect()),
      listPersistedRelays(),
      getContainerHostname(),
    ])
    const enabledRelays = relays.filter((relay) => relay.enabled)
    const { relayRpc } = await import("@/lib/relay-connection")

    const [relayTargets, hearthCandidates] = await Promise.all([
      Promise.all(
        enabledRelays.map(async (relay) => {
          try {
            const inspection = systemInspectionSchema.parse(
              await relayRpc(relay, "relay.system.inspect", {}, 5_000)
            )
            return {
              ...inspection,
              name: relay.name,
              relayId: relay.id,
              reachable: true as const,
            }
          } catch (cause) {
            return {
              component: "relay" as const,
              container: "",
              currentImage: "",
              currentVersion: relay.nodeVersion,
              eligible: false,
              name: relay.name,
              reachable: false as const,
              reason:
                cause instanceof Error
                  ? cause.message
                  : "Relay update support is unavailable",
              relayId: relay.id,
            }
          }
        })
      ),
      Promise.all(
        enabledRelays.map(async (relay) => {
          try {
            const inspection = systemInspectionSchema.parse(
              await relayRpc(
                relay,
                "relay.system.inspect",
                { container },
                5_000
              )
            )
            return inspection.component === "hearth"
              ? {
                  ...inspection,
                  relayId: relay.id,
                  relayName: relay.name,
                }
              : null
          } catch {
            // A remote Relay cannot see Hearth's container and is skipped.
            return null
          }
        })
      ),
    ])
    const hearthTarget = hearthCandidates.find((target) => target) ?? null

    return {
      currentVersion: import.meta.env.VITE_KILN_VERSION,
      hearth: hearthTarget,
      releases,
      relays: relayTargets,
    }
  }
)

export const startSystemUpdate = createServerFn({ method: "POST" })
  .validator(startUpdateSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdministrator()
    const releases = await runAppEffect(
      "updates.latest-release",
      listKilnReleasesEffect()
    )
    const latestRelease = releases[0]
    if (!latestRelease) {
      throw new Error("No public Kiln release is available to install")
    }
    const manifest = await runAppEffect(
      "updates.manifest",
      kilnReleaseManifestEffect(latestRelease.tag)
    )
    validateUpdateManifest(manifest, latestRelease.version, data.component)

    const relays = (await listPersistedRelays()).filter(
      (relay) => relay.enabled
    )
    const { relayRpc } = await import("@/lib/relay-connection")
    const hearthContainer =
      data.component === "hearth" ? await getContainerHostname() : null
    const target =
      data.component === "relay"
        ? await selectedRelay(relays, data.relayId)
        : await coLocatedRelay(relays, hearthContainer ?? "", relayRpc)
    const inspection = systemInspectionSchema.parse(
      await relayRpc(
        target,
        "relay.system.inspect",
        data.component === "relay" ? {} : { container: hearthContainer },
        15_000
      )
    )
    if (inspection.component !== data.component || !inspection.eligible) {
      throw new Error(
        inspection.reason ??
          `This ${data.component} container cannot be updated`
      )
    }

    const component = manifest.components[data.component]
    const operation = updateOperationSchema.parse(
      await relayRpc(
        target,
        "relay.update.apply",
        {
          helperImage: immutableImage(manifest.components.relay),
          targetContainer: inspection.container,
          targetImage: immutableImage(component),
          version: manifest.version,
        },
        15 * 60_000
      )
    )
    return { operation, relayId: target.id }
  })

export const getSystemUpdateStatus = createServerFn({ method: "POST" })
  .validator(updateStatusSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdministrator()
    const relay = await selectedRelay(
      (await listPersistedRelays()).filter((item) => item.enabled),
      data.relayId
    )
    const { relayRpc } = await import("@/lib/relay-connection")
    const result = await relayRpc(
      relay,
      "relay.update.status",
      { operationId: data.operationId },
      15_000
    )
    return result === null ? null : updateOperationSchema.parse(result)
  })

async function selectedRelay(
  relays: Array<PersistedRelay>,
  relayId: string | null
): Promise<PersistedRelay> {
  if (!relayId) throw new Error("Choose a Relay to update")
  const relay = relays.find((candidate) => candidate.id === relayId)
  if (!relay) throw new Error("Relay not found")
  return relay
}

async function coLocatedRelay(
  relays: Array<PersistedRelay>,
  container: string,
  relayRpc: typeof import("@/lib/relay-connection").relayRpc
): Promise<PersistedRelay> {
  const candidates = await Promise.all(
    relays.map(async (relay) => {
      try {
        const inspection = systemInspectionSchema.parse(
          await relayRpc(relay, "relay.system.inspect", { container }, 5_000)
        )
        return inspection.component === "hearth" ? relay : null
      } catch {
        return null
      }
    })
  )
  const selected = candidates.find((relay) => relay)
  if (selected) return selected
  throw new Error(
    "Hearth updates require a paired Relay on the same Docker host"
  )
}

function immutableImage(component: { digest: string; image: string }): string {
  return `${component.image}@${component.digest}`
}

export type UpdateOverview = Awaited<ReturnType<typeof getUpdateOverview>>
