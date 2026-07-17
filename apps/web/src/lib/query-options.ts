import { queryOptions } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"

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
  getRelaySnapshot,
  getRelayTree,
} from "@/server/relay"
import { getRelays } from "@/server/relays"

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
    file: (instanceId: string, path: string) =>
      ["relay", "instances", instanceId, "files", "content", path] as const,
    files: (instanceId: string) =>
      ["relay", "instances", instanceId, "files"] as const,
    snapshot: ["relay", "snapshot"] as const,
    tree: (instanceId: string) =>
      ["relay", "instances", instanceId, "files", "tree"] as const,
  },
  relays: ["relays"] as const,
  uiPreferences: ["ui", "preferences"] as const,
}

export function relayConnectionQueryOptions(queryClient: QueryClient) {
  return queryOptions({
    queryKey: queryKeys.relay.connection,
    queryFn: async () => {
      const connection = await getRelayConnectionState({
        headers: relayPollHeaders,
      })
      if (connection.status === "connected") {
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

export function relayTreeQueryOptions(instanceId: string) {
  return queryOptions({
    queryKey: queryKeys.relay.tree(instanceId),
    queryFn: () => getRelayTree({ data: { instanceId } }),
    staleTime: 15_000,
  })
}

export function relayFileQueryOptions(instanceId: string, path: string) {
  return queryOptions({
    queryKey: queryKeys.relay.file(instanceId, path),
    queryFn: () => getRelayFile({ data: { instanceId, path } }),
    staleTime: 15_000,
  })
}
