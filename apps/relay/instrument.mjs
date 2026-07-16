import * as Sentry from "@sentry/node"

Sentry.init({
  dsn:
    process.env.SENTRY_DSN ||
    "https://9516d942af12672a1ff5aa7f181f7217@o4511745768226816.ingest.us.sentry.io/4511745775501312",
  environment:
    process.env.SENTRY_ENVIRONMENT ||
    process.env.KILN_ENVIRONMENT ||
    "production",
  release: process.env.SENTRY_RELEASE || process.env.SOURCE_COMMIT,
  sendDefaultPii: false,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 1),
  initialScope: {
    tags: { "kiln.service": "relay" },
  },
})
