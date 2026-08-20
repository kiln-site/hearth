import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { z } from "zod"

import { InvitationPage } from "@/components/invitation-page"
import { recoverPromise } from "@/effect/promise"
import { invitePath } from "@/lib/invitation-auth"
import { pageTitle } from "@/lib/page-title"
import { invitationPreviewQueryOptions } from "@/lib/query-options"
import { getInvitationPreview } from "@/server/access"
import { getAuthState } from "@/server/auth"

export const Route = createFileRoute("/invite")({
  validateSearch: z.object({ token: z.string().min(32) }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  beforeLoad: async ({ search }) => {
    const state = await getAuthState()
    if (state.user) return state
    const preview = await recoverPromise(
      () => getInvitationPreview({ data: { token: search.token } }),
      () => null
    )
    if (!preview) return state
    throw redirect({
      to: "/",
      search: {
        email: preview.email,
        redirect: invitePath(search.token),
      },
    })
  },
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
