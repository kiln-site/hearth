import { Outlet, createFileRoute, notFound } from "@tanstack/react-router"

import {
  relayConnectionQueryOptions,
  relaySnapshotQueryOptions,
} from "@/lib/query-options"
import { findRelayInstance } from "@/lib/relay-selectors"

export const Route = createFileRoute("/_app/server/$serverId")({
  loader: async ({ context, params }) => {
    if (params.serverId === "unavailable") return

    const connection = await context.queryClient.ensureQueryData(
      relayConnectionQueryOptions(context.queryClient)
    )
    const snapshot =
      connection.status === "connected"
        ? connection.snapshot
        : await context.queryClient.ensureQueryData(relaySnapshotQueryOptions())

    if (!findRelayInstance(snapshot.instances, params.serverId)) {
      throw notFound({ routeId: "/_app" })
    }
  },
  component: Outlet,
})
