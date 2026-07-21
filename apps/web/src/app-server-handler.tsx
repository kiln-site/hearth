import {
  RouterContextProvider,
  type AnyRouter,
} from "@tanstack/react-router"
import {
  defineHandlerCallback,
  renderRouterToStream,
} from "@tanstack/react-router/ssr/server"

import { AppRouterApplication } from "@/components/app-router-application"

function HearthStartServer({ router }: { router: AnyRouter }) {
  return (
    <RouterContextProvider router={router}>
      <AppRouterApplication />
    </RouterContextProvider>
  )
}

export const hearthStreamHandler = defineHandlerCallback(
  ({ request, router, responseHeaders }) =>
    renderRouterToStream({
      request,
      router,
      responseHeaders,
      children: <HearthStartServer router={router} />,
    })
)
