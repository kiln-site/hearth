import { Matches, useRouterState } from "@tanstack/react-router"

import { AppDocument } from "@/components/app-document"
import { AppFrame } from "@/components/app-frame"

export function AppRouterApplication() {
  const usesAppFrame = useRouterState({
    select: (state) =>
      state.matches.some((match) => match.routeId === "/_app"),
  })

  return (
    <AppDocument>
      {usesAppFrame ? (
        <AppFrame>
          <Matches />
        </AppFrame>
      ) : (
        <Matches />
      )}
    </AppDocument>
  )
}
