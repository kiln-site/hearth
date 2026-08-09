import { createFileRoute, redirect } from "@tanstack/react-router"
import { z } from "zod"

import { CliAuthorizationPage } from "@/components/cli-authorization-page"
import { pageTitle } from "@/lib/page-title"
import { getAuthState } from "@/server/auth"
import { getCliAuthorizationRequest } from "@/server/cli"

export const Route = createFileRoute("/cli/authorize")({
  validateSearch: z.object({ code: z.string().max(12).optional() }),
  beforeLoad: async ({ location }) => {
    const state = await getAuthState()
    if (!state.user) {
      throw redirect({
        to: "/",
        search: { redirect: location.href },
      })
    }
    return { user: state.user }
  },
  loaderDeps: ({ search }) => ({ code: search.code }),
  loader: async ({ deps }) =>
    deps.code
      ? getCliAuthorizationRequest({ data: { userCode: deps.code } })
      : { defaultAccessDays: 30, request: null, requestError: null },
  head: () => ({ meta: [{ title: pageTitle("Authorize CLI") }] }),
  component: CliAuthorizationRoute,
})

function CliAuthorizationRoute() {
  const data = Route.useLoaderData()
  const navigate = Route.useNavigate()
  return (
    <CliAuthorizationPage
      {...data}
      onCodeSubmit={(code) => {
        void navigate({ search: { code: code.trim().toUpperCase() } })
      }}
    />
  )
}
