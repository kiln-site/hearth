import * as Sentry from "@sentry/node"

const dsn = process.env.SENTRY_DSN?.trim()

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT ||
      process.env.KILN_ENVIRONMENT ||
      "production",
    release: process.env.SENTRY_RELEASE || process.env.SOURCE_COMMIT,
    sendDefaultPii: false,
    tracesSampleRate: parseSampleRate(
      process.env.SENTRY_TRACES_SAMPLE_RATE,
      process.env.NODE_ENV === "production" ? 0.1 : 1
    ),
    initialScope: {
      tags: { "kiln.service": "relay" },
    },
  })
}

function parseSampleRate(value, fallback) {
  if (!value?.trim()) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : fallback
}
