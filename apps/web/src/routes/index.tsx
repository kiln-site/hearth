import { createFileRoute, redirect } from "@tanstack/react-router"
import { z } from "zod"

import { AuthPage } from "@/components/auth-page"
import { getInvitationPreview } from "@/server/access"
import { getAuthState } from "@/server/auth"
import { getRelaySnapshot } from "@/server/relay"

export const Route = createFileRoute("/")({
  validateSearch: z.object({
    email: z.string().optional(),
    forgot: z.union([z.literal(true), z.literal("true")]).optional(),
    redirect: z.string().optional(),
    signup: z.union([z.literal(true), z.literal("true")]).optional(),
    verified: z.union([z.literal(true), z.literal("true")]).optional(),
  }),
  beforeLoad: async ({ search }) => {
    const state = await getAuthState()
    if (!state.user) {
      let invitationSignup = false
      if (search.signup && search.redirect?.startsWith("/invite?")) {
        const token = new URL(
          search.redirect,
          "http://kiln.local"
        ).searchParams.get("token")
        if (token) {
          const invitation = await getInvitationPreview({
            data: { token },
          }).catch(() => null)
          invitationSignup = Boolean(
            invitation &&
            search.email &&
            invitation.email.toLowerCase() === search.email.toLowerCase()
          )
        }
      }
      return { ...state, invitationSignup }
    }
    if (search.redirect?.startsWith("/")) {
      throw redirect({ href: search.redirect })
    }
    const snapshot = await getRelaySnapshot()
    throw redirect({
      to: "/$serverId/console",
      params: { serverId: snapshot.instances.at(0)?.shortId ?? "unavailable" },
    })
  },
  component: LoginRoute,
})

function LoginRoute() {
  const search = Route.useSearch()
  const {
    developmentBypassEnabled,
    emailDeliveryEnabled,
    invitationSignup,
    setupRequired,
    signupEnabled,
  } = Route.useRouteContext()
  return (
    <AuthPage
      developmentBypassEnabled={developmentBypassEnabled}
      emailDeliveryEnabled={emailDeliveryEnabled}
      initialEmail={search.email}
      forgotPassword={Boolean(search.forgot)}
      redirectPath={search.redirect}
      setupRequired={setupRequired}
      signupEnabled={signupEnabled || invitationSignup}
      startWithSignup={invitationSignup}
      verified={Boolean(search.verified)}
    />
  )
}
