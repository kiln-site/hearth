import * as Sentry from "@sentry/tanstackstart-react"

const dsn =
  import.meta.env.VITE_SENTRY_DSN ??
  "https://9516d942af12672a1ff5aa7f181f7217@o4511745768226816.ingest.us.sentry.io/4511745775501312"

Sentry.init({
  dsn,
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_KILN_BUILD_SHA || undefined,
  sendDefaultPii: false,
  dataCollection: {
    userInfo: false,
    httpBodies: [],
  },
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
  tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 1),
  replaysSessionSampleRate: Number(
    import.meta.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE ?? 0.1
  ),
  replaysOnErrorSampleRate: 1,
})

if (
  import.meta.env.DEV &&
  import.meta.env.VITE_SENTRY_VERIFICATION_ENABLED === "true"
) {
  Object.defineProperty(window, "__kilnVerifySentry", {
    configurable: true,
    value: async () => {
      const eventId = Sentry.captureException(
        new Error("Kiln browser Sentry verification")
      )
      await Sentry.flush(5_000)
      return eventId
    },
  })
}
