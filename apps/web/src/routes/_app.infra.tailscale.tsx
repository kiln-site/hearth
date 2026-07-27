import { createFileRoute, redirect } from "@tanstack/react-router"

import { TailscalePage } from "@/components/tailscale-page"
import { pageTitle } from "@/lib/page-title"
import { relaysQueryOptions } from "@/lib/query-options"

export const Route = createFileRoute("/_app/infra/tailscale")({
  beforeLoad: ({ context }) => {
    if (!context.user.isDevelopmentBypass && context.user.role !== "admin") {
      throw redirect({ to: "/infra/servers", replace: true })
    }
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(relaysQueryOptions()),
  head: () => ({ meta: [{ title: pageTitle("Tailscale") }] }),
  component: TailscalePage,
})
