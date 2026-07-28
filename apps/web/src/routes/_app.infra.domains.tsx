import { createFileRoute, redirect } from "@tanstack/react-router"

import { DomainsPage } from "@/components/domains-page"
import { pageTitle } from "@/lib/page-title"
import { domainSettingsQueryOptions } from "@/lib/query-options"

export const Route = createFileRoute("/_app/infra/domains")({
  beforeLoad: ({ context }) => {
    if (!context.user.isDevelopmentBypass && context.user.role !== "admin") {
      throw redirect({ to: "/infra/servers", replace: true })
    }
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(domainSettingsQueryOptions()),
  head: () => ({ meta: [{ title: pageTitle("Domains") }] }),
  component: DomainsPage,
})
