import { queryOptions } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import type { RelayInstance } from "@workspace/contracts"

import {
  getAccessCapabilities,
  getAccessOverview,
  getInvitationPreview,
} from "@/server/access"
import { getBrickCatalog, getInstanceStartup } from "@/server/bricks"
import { getDomainSettings, getInstanceDomain } from "@/server/domains"
import { getUiPreferences } from "@/server/preferences"
import { reconcilePendingPowerSnapshot } from "@/lib/instance-power-state"
import {
  getRelayConnectionState,
  getRelayFile,
  getRelayFileActivity,
  getRelaySnapshot,
  getRelayTree,
} from "@/server/relay"
import { getRelays, getRelayTailscale } from "@/server/relays"
import { getTailscaleStacks } from "@/server/tailscale"
import { getAuthState } from "@/server/auth"
import { getUpdateOverview } from "@/server/updates"
import type { RelayFleetSnapshot } from "@/lib/relay-fleet"

export type UiPreferences = Awaited<ReturnType<typeof getUiPreferences>>

export type RelayConnection = Awaited<
  ReturnType<typeof getRelayConnectionState>
>

const connectedRelayPollDelayMs = 5_000
const disconnectedRelayPollDelayMs = 15_000
const relayPollHeaders = { "x-kiln-request-purpose": "relay-poll" }

export const queryKeys = {
  auth: {
    state: ["auth", "state"] as const,
  },
  access: {
    capabilities: ["access", "capabilities"] as const,
    invitation: (token: string) => ["access", "invitation", token] as const,
    overview: ["access", "overview"] as const,
  },
  bricks: ["bricks", "catalog"] as const,
  domains: {
    instance: (relayId: string, instanceId: string) =>
      ["domains", "instances", relayId, instanceId] as const,
    settings: ["domains", "settings"] as const,
  },
  relay: {
    all: ["relay"] as const,
    connection: ["relay", "connection"] as const,
    console: (relayId: string, instanceId: string) =>
      ["relay", relayId, "instances", instanceId, "console"] as const,
    file: (relayId: string, instanceId: string, path: string) =>
      [
        "relay",
        relayId,
        "instances",
        instanceId,
        "files",
        "content",
        path,
      ] as const,
    fileActivity: (relayId: string, instanceId: string) =>
      ["relay", relayId, "instances", instanceId, "files", "activity"] as const,
    snapshot: ["relay", "snapshot"] as const,
    tree: (relayId: string, instanceId: string) =>
      ["relay", relayId, "instances", instanceId, "files", "tree"] as const,
  },
  relays: ["relays"] as const,
  tailscale: (relayId: string) => ["relays", relayId, "tailscale"] as const,
  tailscaleStacks: ["tailscale", "stacks"] as const,
  updates: ["updates", "overview"] as const,
  uiPreferences: ["ui", "preferences"] as const,
}

export function replaceRelaySnapshotInstance(
  snapshot: RelayFleetSnapshot | undefined,
  updated: RelayInstance & { relayId: string }
): RelayFleetSnapshot | undefined {
  return snapshot
    ? {
        ...snapshot,
        instances: snapshot.instances.map((instance) =>
          instance.id === updated.id && instance.relayId === updated.relayId
            ? { ...instance, ...updated }
            : instance
        ),
      }
    : snapshot
}

export function authStateQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.auth.state,
    queryFn: () => getAuthState(),
    staleTime: 30_000,
  })
}

export function relayConnectionQueryOptions(queryClient: QueryClient) {
  return queryOptions({
    queryKey: queryKeys.relay.connection,
    queryFn: async () => {
      const connection = await getRelayConnectionState({
        headers: relayPollHeaders,
      })
      if (connection.status === "connected") {
        // Each router owns one QueryClient per SSR request or browser session.
        // Prime that same client from the connection's canonical snapshot so
        // snapshot consumers do not make a second Relay request.
        queryClient.setQueryData(
          queryKeys.relay.snapshot,
          reconcilePendingPowerSnapshot(connection.snapshot)
        )
      }
      return connection
    },
    refetchInterval: (query) => {
      if (query.state.data?.status === "paused") return false
      return query.state.data?.status === "connected"
        ? connectedRelayPollDelayMs
        : disconnectedRelayPollDelayMs
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    staleTime: connectedRelayPollDelayMs,
  })
}

export function relaySnapshotQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.relay.snapshot,
    queryFn: async () =>
      reconcilePendingPowerSnapshot(await getRelaySnapshot()),
    staleTime: connectedRelayPollDelayMs,
  })
}

export function accessCapabilitiesQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.access.capabilities,
    queryFn: () => getAccessCapabilities(),
    staleTime: 30_000,
  })
}

export function accessOverviewQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.access.overview,
    queryFn: () => getAccessOverview(),
  })
}

export function invitationPreviewQueryOptions(token: string) {
  return queryOptions({
    queryKey: queryKeys.access.invitation(token),
    queryFn: () => getInvitationPreview({ data: { token } }),
    staleTime: 30_000,
  })
}

export function uiPreferencesQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.uiPreferences,
    queryFn: () => getUiPreferences(),
    staleTime: Infinity,
  })
}

export function relaysQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.relays,
    queryFn: () => getRelays(),
    staleTime: Infinity,
  })
}

export function relayTailscaleQueryOptions(relayId: string) {
  return queryOptions({
    queryKey: queryKeys.tailscale(relayId),
    queryFn: () => getRelayTailscale({ data: { id: relayId } }),
    retry: false,
    staleTime: 5_000,
  })
}

export function tailscaleStacksQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.tailscaleStacks,
    queryFn: () => getTailscaleStacks(),
    retry: false,
    staleTime: 10_000,
  })
}

export function updateOverviewQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.updates,
    queryFn: () => getUpdateOverview(),
    staleTime: 30_000,
  })
}

export function brickCatalogQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.bricks,
    queryFn: () => getBrickCatalog(),
  })
}

export function domainSettingsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.domains.settings,
    queryFn: () => getDomainSettings(),
  })
}

export function instanceDomainQueryOptions(
  relayId: string,
  instanceId: string
) {
  return queryOptions({
    queryKey: queryKeys.domains.instance(relayId, instanceId),
    queryFn: () => getInstanceDomain({ data: { instanceId, relayId } }),
    retry: false,
    staleTime: 10_000,
  })
}

export function instanceStartupQueryOptions(
  relayId: string,
  instanceId: string
) {
  return queryOptions({
    queryKey: ["relay", relayId, "instances", instanceId, "startup"] as const,
    queryFn: () => getInstanceStartup({ data: { instanceId, relayId } }),
    staleTime: 15_000,
  })
}

export function relayTreeQueryOptions(relayId: string, instanceId: string) {
  return queryOptions({
    queryKey: queryKeys.relay.tree(relayId, instanceId),
    queryFn: () => getRelayTree({ data: { instanceId, relayId } }),
    staleTime: 15_000,
  })
}

export function relayFileQueryOptions(
  relayId: string,
  instanceId: string,
  path: string
) {
  return queryOptions({
    queryKey: queryKeys.relay.file(relayId, instanceId, path),
    queryFn: () => getRelayFile({ data: { instanceId, path, relayId } }),
    staleTime: 15_000,
  })
}

export function relayFileActivityQueryOptions(
  relayId: string,
  instanceId: string
) {
  return queryOptions({
    queryKey: queryKeys.relay.fileActivity(relayId, instanceId),
    queryFn: () => getRelayFileActivity({ data: { instanceId, relayId } }),
    staleTime: 15_000,
  })
}
