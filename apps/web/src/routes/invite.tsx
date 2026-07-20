import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

import { InvitationPage } from "@/components/invitation-page"
import { pageTitle } from "@/lib/page-title"
import { invitationPreviewQueryOptions } from "@/lib/query-options"
import { getAuthState } from "@/server/auth"

export const Route = createFileRoute("/invite")({
  validateSearch: z.object({ token: z.string().min(32) }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  beforeLoad: async () => getAuthState(),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(
      invitationPreviewQueryOptions(deps.token)
    ),
  head: () => ({ meta: [{ title: pageTitle("Invitation") }] }),
  component: InviteRoute,
})

function InviteRoute() {
  const { token } = Route.useSearch()
  const { user } = Route.useRouteContext()
  const { data: preview } = useSuspenseQuery(
    invitationPreviewQueryOptions(token)
  )
  return <InvitationPage preview={preview} token={token} user={user} />
}
