import * as Sentry from "@sentry/tanstackstart-react"
import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query"

import {
  AppNotFoundPage,
  AppRouterErrorBoundary,
} from "@/components/app-error-page"
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
    defaultNotFoundComponent: AppNotFoundPage,
    disableGlobalCatchBoundary: true,
    InnerWrap: AppRouterErrorBoundary,
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
