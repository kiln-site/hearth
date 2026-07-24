import { createFileRoute, redirect } from "@tanstack/react-router"

import { InfraUpdatesPage } from "@/components/infra-updates-page"
import { pageTitle } from "@/lib/page-title"
import {
  accessCapabilitiesQueryOptions,
  updateOverviewQueryOptions,
} from "@/lib/query-options"

export const Route = createFileRoute("/_app/infra/updates")({
  beforeLoad: async ({ context }) => {
    const capabilities = await context.queryClient.ensureQueryData(
      accessCapabilitiesQueryOptions()
    )
    if (!capabilities.isPlatformAdmin) {
      throw redirect({ to: "/" })
    }
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(updateOverviewQueryOptions()),
  head: () => ({ meta: [{ title: pageTitle("System Updates") }] }),
  component: InfraUpdatesPage,
})
