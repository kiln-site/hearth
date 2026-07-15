import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

import { InvitationPage } from "@/components/invitation-page"
import { getInvitationPreview } from "@/server/access"
import { getAuthState } from "@/server/auth"

export const Route = createFileRoute("/invite")({
  validateSearch: z.object({ token: z.string().min(32) }),
  beforeLoad: async () => getAuthState(),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }) =>
    getInvitationPreview({ data: { token: deps.token } }),
  component: InviteRoute,
})

function InviteRoute() {
  const { token } = Route.useSearch()
  const { user } = Route.useRouteContext()
  return (
    <InvitationPage preview={Route.useLoaderData()} token={token} user={user} />
  )
}
