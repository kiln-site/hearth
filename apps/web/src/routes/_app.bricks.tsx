import { createFileRoute, redirect } from "@tanstack/react-router"

import { BricksPage } from "@/components/bricks-page"
import { pageTitle } from "@/lib/page-title"
import { getAuthState } from "@/server/auth"
import {
  brickStudioQueryOptions,
  relayConnectionQueryOptions,
} from "@/lib/query-options"

export const Route = createFileRoute("/_app/bricks")({
  head: () => ({ meta: [{ title: pageTitle("Bricks") }] }),
  beforeLoad: async ({ context }) => {
    const { user } = await getAuthState()
    if (!user?.isDevelopmentBypass && user?.role !== "admin") {
      throw redirect({ to: "/" })
    }
    const connection = await context.queryClient.ensureQueryData(
      relayConnectionQueryOptions(context.queryClient)
    )
    if (connection.status !== "connected") {
      throw redirect({ to: "/settings" })
    }
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(brickStudioQueryOptions()),
  component: BricksRoute,
})

function BricksRoute() {
  return <BricksPage />
}
