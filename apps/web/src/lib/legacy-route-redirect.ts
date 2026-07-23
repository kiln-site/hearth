import { redirect } from "@tanstack/react-router"

import { findFirstCanonicalRelayInstance } from "@/lib/relay-selectors"
import { getRelayConnectionState } from "@/server/relay"
import { getAuthState } from "@/server/auth"

export async function redirectLegacyPage(
  page: "console" | "files" | "info"
): Promise<never> {
  const { user } = await getAuthState()
  if (!user) {
    throw redirect({
      to: "/",
      search: { redirect: `/${page}` },
      replace: true,
    })
  }
  const connection = await getRelayConnectionState()
  if (connection.status !== "connected") {
    if (user.isDevelopmentBypass || user.role === "admin") {
      throw redirect({ to: "/settings", replace: true })
    }
    throw redirect({
      to: `/server/$serverId/${page}`,
      params: { serverId: "unavailable" },
      replace: true,
    })
  }
  const instance = findFirstCanonicalRelayInstance(
    connection.snapshot.instances
  )
  if (!instance) {
    throw redirect({ to: "/servers", replace: true })
  }
  throw redirect({
    to: `/server/$serverId/${page}`,
    params: {
      serverId: instance.shortId,
    },
    replace: true,
  })
}
