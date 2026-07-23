import { createFileRoute, redirect } from "@tanstack/react-router"
import { z } from "zod"

import { AuthPage } from "@/components/auth-page"
import { pageTitle } from "@/lib/page-title"
import { relayConnectionQueryOptions } from "@/lib/query-options"
import {
  relayInstanceRouteIdentifier,
  resolveCanonicalRelayInstance,
  resolveRelayInstance,
} from "@/lib/relay-selectors"
import { getInvitationPreview } from "@/server/access"
import { getAuthState } from "@/server/auth"
import { getUiPreferences } from "@/server/preferences"

export const Route = createFileRoute("/")({
  validateSearch: z.object({
    email: z.string().optional(),
    forgot: z.union([z.literal(true), z.literal("true")]).optional(),
    redirect: z.string().optional(),
    signup: z.union([z.literal(true), z.literal("true")]).optional(),
    verified: z.union([z.literal(true), z.literal("true")]).optional(),
  }),
  beforeLoad: async ({ context, search }) => {
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
    const [connection, uiPreferences] = await Promise.all([
      context.queryClient.ensureQueryData(
        relayConnectionQueryOptions(context.queryClient)
      ),
      getUiPreferences(),
    ])
    if (connection.status !== "connected") {
      if (state.user.isDevelopmentBypass || state.user.role === "admin") {
        throw redirect({ to: "/settings" })
      }
      throw redirect({
        to: "/server/$serverId/console",
        params: { serverId: "unavailable" },
      })
    }
    const instances = connection.snapshot.instances
    const rememberedResolution = resolveCanonicalRelayInstance(
      instances,
      uiPreferences.selectedInstanceRouteId
    )
    const rememberedAliasResolution = resolveRelayInstance(
      instances,
      uiPreferences.selectedInstanceRouteId
    )
    const rememberedInstance =
      rememberedResolution.status === "found"
        ? rememberedResolution.instance
        : null
    const rememberedRouteIdentifier = rememberedInstance
      ? relayInstanceRouteIdentifier(instances, rememberedInstance)
      : null
    if (!rememberedInstance || !rememberedRouteIdentifier) {
      const collisionSearch =
        rememberedResolution.status === "ambiguous"
          ? rememberedAliasResolution.status === "found"
            ? rememberedAliasResolution.instance.shortId
            : uiPreferences.selectedInstanceRouteId
          : null
      throw redirect({
        href: collisionSearch
          ? `/servers?search=${encodeURIComponent(collisionSearch)}`
          : "/servers",
      })
    }
    throw redirect({
      to: "/server/$serverId/console",
      params: {
        serverId: rememberedRouteIdentifier,
      },
    })
  },
  head: () => ({ meta: [{ title: pageTitle("Sign In") }] }),
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
