import { redirect } from "@tanstack/react-router"

import { getRelaySnapshot } from "@/server/relay"
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
  const snapshot = await getRelaySnapshot()
  throw redirect({
    to: `/$serverId/${page}`,
    params: { serverId: snapshot.instances.at(0)?.shortId ?? "unavailable" },
    replace: true,
  })
}
