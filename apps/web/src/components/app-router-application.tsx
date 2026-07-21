import { Matches, useRouterState } from "@tanstack/react-router"

import { AppDocument } from "@/components/app-document"
import { AppRouterErrorBoundary } from "@/components/app-error-page"
import { AppFrame } from "@/components/app-frame"

export function AppRouterApplication() {
  const usesAppFrame = useRouterState({
    select: (state) =>
      state.matches.some((match) => match.routeId === "/_app"),
  })

  return (
    <AppDocument>
      <AppRouterErrorBoundary>
        {usesAppFrame ? (
          <AppFrame>
            <Matches />
          </AppFrame>
        ) : (
          <Matches />
        )}
      </AppRouterErrorBoundary>
    </AppDocument>
  )
}
