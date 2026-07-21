import { createFileRoute, redirect } from "@tanstack/react-router"

import { AppFrame } from "@/components/app-frame"
import { getAuthState } from "@/server/auth"
import {
  accessCapabilitiesQueryOptions,
  relayConnectionQueryOptions,
  uiPreferencesQueryOptions,
} from "@/lib/query-options"

export const Route = createFileRoute("/_app")({
  staleTime: Infinity,
  beforeLoad: async ({ location }) => {
    const { user } = await getAuthState()
    if (!user) {
      throw redirect({
        to: "/",
        search: { redirect: location.href },
      })
    }
    return { user }
  },
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(
        relayConnectionQueryOptions(context.queryClient)
      ),
      context.queryClient.ensureQueryData(accessCapabilitiesQueryOptions()),
      context.queryClient.ensureQueryData(uiPreferencesQueryOptions()),
    ])
  },
  component: AppLayout,
})

function AppLayout() {
  return <AppFrame />
}
