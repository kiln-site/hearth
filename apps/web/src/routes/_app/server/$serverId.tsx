import {
  Outlet,
  createFileRoute,
  notFound,
  redirect,
} from "@tanstack/react-router"

import {
  relayConnectionQueryOptions,
  relaySnapshotQueryOptions,
} from "@/lib/query-options"
import {
  relayInstanceRouteIdentifier,
  resolveRelayInstance,
} from "@/lib/relay-selectors"

export const Route = createFileRoute("/_app/server/$serverId")({
  staleTime: Infinity,
  loader: async ({ context, location, params }) => {
    if (params.serverId === "unavailable") return

    const connection = await context.queryClient.ensureQueryData(
      relayConnectionQueryOptions(context.queryClient)
    )
    const snapshot =
      connection.status === "connected"
        ? connection.snapshot
        : await context.queryClient.ensureQueryData(relaySnapshotQueryOptions())

    const resolution = resolveRelayInstance(snapshot.instances, params.serverId)
    if (resolution.status === "ambiguous") {
      throw redirectToServerList(params.serverId)
    }
    if (resolution.status === "not-found") {
      throw notFound({ routeId: "/_app" })
    }
    const instance = resolution.instance
    const routeIdentifier = relayInstanceRouteIdentifier(
      snapshot.instances,
      instance
    )
    if (!routeIdentifier) {
      throw redirectToServerList(instance.shortId)
    }

    if (params.serverId !== routeIdentifier) {
      const segments = location.pathname.split("/")
      segments[2] = encodeURIComponent(routeIdentifier)
      throw redirect({
        href: `${segments.join("/")}${location.searchStr}${location.hash ? `#${location.hash}` : ""}`,
        replace: true,
      })
    }
  },
  component: Outlet,
})

function redirectToServerList(shortId: string) {
  return redirect({
    href: `/servers?search=${encodeURIComponent(shortId)}`,
    replace: true,
  })
}
