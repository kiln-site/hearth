import * as Sentry from "@sentry/tanstackstart-react"
import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query"

import { createAppQueryClient } from "@/lib/query-client"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  const queryClient = createAppQueryClient()
  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },

    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultStructuralSharing: true,
    // The root route already owns Hearth's error and not-found UI. Keeping the
    // router-wide boundary as well makes every completed navigation reset a
    // component whose visual bounds are the entire document, which causes the
    // whole app shell to be marked and painted as changed.
    disableGlobalCatchBoundary: true,
  })

  setupRouterSsrQueryIntegration({ queryClient, router })

  if (!router.isServer && Sentry.isInitialized()) {
    Sentry.addIntegration(
      Sentry.tanstackRouterBrowserTracingIntegration(router)
    )
  }

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
