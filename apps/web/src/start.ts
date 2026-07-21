import {
  sentryGlobalFunctionMiddleware,
  sentryGlobalRequestMiddleware,
} from "@sentry/tanstackstart-react"
import { createCsrfMiddleware, createStart } from "@tanstack/react-start"

const csrfMiddleware = createCsrfMiddleware({
  filter: (context) => context.handlerType === "serverFn",
})

export const startInstance = createStart(() => ({
  requestMiddleware: [sentryGlobalRequestMiddleware, csrfMiddleware],
  functionMiddleware: [sentryGlobalFunctionMiddleware],
}))
