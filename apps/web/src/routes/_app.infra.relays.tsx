import { createFileRoute, redirect } from "@tanstack/react-router"

import { RelaysPage } from "@/components/relays-page"
import { pageTitle } from "@/lib/page-title"
import {
  accessCapabilitiesQueryOptions,
  relaysQueryOptions,
} from "@/lib/query-options"

export const Route = createFileRoute("/_app/infra/relays")({
  beforeLoad: async ({ context }) => {
    const capabilities = await context.queryClient.ensureQueryData(
      accessCapabilitiesQueryOptions()
    )
    if (!capabilities.canManageRelays) {
      throw redirect({ to: "/infra/servers", replace: true })
    }
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(relaysQueryOptions()),
  head: () => ({ meta: [{ title: pageTitle("Relays") }] }),
  component: RelaysPage,
})
