import { createFileRoute, redirect } from "@tanstack/react-router"

import { BricksPage } from "@/components/bricks-page"
import { pageTitle } from "@/lib/page-title"
import { getAuthState } from "@/server/auth"
import { brickStudioQueryOptions } from "@/lib/query-options"

export const Route = createFileRoute("/_app/bricks")({
  beforeLoad: async () => {
    const { user } = await getAuthState()
    if (!user?.isDevelopmentBypass && user?.role !== "admin") {
      throw redirect({ to: "/" })
    }
  },
  loader: ({ context }) =>
    context.queryClient.prefetchQuery(brickStudioQueryOptions()),
  head: () => ({ meta: [{ title: pageTitle("Bricks") }] }),
  component: BricksRoute,
})

function BricksRoute() {
  return <BricksPage />
}
