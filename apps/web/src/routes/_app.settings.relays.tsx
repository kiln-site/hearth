import { createFileRoute } from "@tanstack/react-router"

import { AppSettingsPage } from "@/components/app-settings-page"
import { pageTitle } from "@/lib/page-title"
import { relaysQueryOptions } from "@/lib/query-options"

export const Route = createFileRoute("/_app/settings/relays")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(relaysQueryOptions()),
  head: () => ({ meta: [{ title: pageTitle("Relay Settings") }] }),
  component: AppSettingsPage,
})
