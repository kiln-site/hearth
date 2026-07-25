import { createFileRoute, redirect } from "@tanstack/react-router"

import { RelaysPage } from "@/components/relays-page"
import { pageTitle } from "@/lib/page-title"
import { relaysQueryOptions } from "@/lib/query-options"

export const Route = createFileRoute("/_app/infra/relays")({
  beforeLoad: ({ context }) => {
    if (!context.user.isDevelopmentBypass && context.user.role !== "admin") {
      throw redirect({ to: "/infra/servers" })
    }
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(relaysQueryOptions()),
  head: () => ({ meta: [{ title: pageTitle("Relays") }] }),
  component: RelaysPage,
})
