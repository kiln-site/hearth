import { createFileRoute, redirect } from "@tanstack/react-router"

import { BricksPage } from "@/components/bricks-page"
import { pageTitle } from "@/lib/page-title"
import { getAuthState } from "@/server/auth"
import { getBrickStudio } from "@/server/bricks"
import { getRelayConnectionState } from "@/server/relay"

export const Route = createFileRoute("/_app/bricks")({
  head: () => ({ meta: [{ title: pageTitle("Bricks") }] }),
  beforeLoad: async () => {
    const { user } = await getAuthState()
    if (!user?.isDevelopmentBypass && user?.role !== "admin") {
      throw redirect({ to: "/" })
    }
    if ((await getRelayConnectionState()).status !== "connected") {
      throw redirect({ to: "/settings" })
    }
  },
  loader: () => getBrickStudio(),
  component: BricksRoute,
})

function BricksRoute() {
  return <BricksPage initialStudio={Route.useLoaderData()} />
}
