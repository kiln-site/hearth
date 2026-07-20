import { queryOptions } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import type { RelayInstance } from "@workspace/contracts"

import {
  getAccessCapabilities,
  getAccessOverview,
  getInvitationPreview,
} from "@/server/access"
import { getBrickStudio } from "@/server/bricks"
import { getUiPreferences } from "@/server/preferences"
import {
  getRelayConnectionState,
  getRelayFile,
  getRelayFileActivity,
  getRelaySnapshot,
  getRelayTree,
} from "@/server/relay"
import { getRelays } from "@/server/relays"
import type { RelayFleetSnapshot } from "@/lib/relay-fleet"

export type RelayConnection = Awaited<
  ReturnType<typeof getRelayConnectionState>
>

const connectedRelayPollDelayMs = 5_000
const disconnectedRelayPollDelayMs = 15_000
const relayPollHeaders = { "x-kiln-request-purpose": "relay-poll" }

export const queryKeys = {
  access: {
    capabilities: ["access", "capabilities"] as const,
    invitation: (token: string) => ["access", "invitation", token] as const,
    overview: ["access", "overview"] as const,
  },
  bricks: ["bricks", "studio"] as const,
  relay: {
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
  uiPreferences: ["ui", "preferences"] as const,
}

export function replaceRelaySnapshotInstance(
  snapshot: RelayFleetSnapshot | undefined,
  updated: RelayInstance
): RelayFleetSnapshot | undefined {
  return snapshot
    ? {
        ...snapshot,
        instances: snapshot.instances.map((instance) =>
          instance.id === updated.id ? { ...instance, ...updated } : instance
        ),
      }
    : snapshot
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
        queryClient.setQueryData(queryKeys.relay.snapshot, connection.snapshot)
      }
      return connection
    },
    refetchInterval: (query) =>
      query.state.data?.status === "connected"
        ? connectedRelayPollDelayMs
        : disconnectedRelayPollDelayMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    staleTime: connectedRelayPollDelayMs,
  })
}

export function relaySnapshotQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.relay.snapshot,
    queryFn: () => getRelaySnapshot(),
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
  })
}

export function brickStudioQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.bricks,
    queryFn: () => getBrickStudio(),
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
