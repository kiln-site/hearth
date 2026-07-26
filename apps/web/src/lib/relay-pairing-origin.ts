interface RelayPairingOriginOptions {
  browserOrigin: URL
  caCertificatePem: string | null
  enrollmentOrigin?: URL
  environment?: NodeJS.ProcessEnv
}

export function relayPairingOrigin({
  browserOrigin,
  caCertificatePem,
  enrollmentOrigin,
  environment = process.env,
}: RelayPairingOriginOptions): URL {
  if (enrollmentOrigin) return enrollmentOrigin
  if (!caCertificatePem) return browserOrigin

  const hostname = environment.KILN_RELAY_HOST?.trim()
  if (!hostname) return browserOrigin
  const port = Number(environment.KILN_RELAY_PORT?.trim() || 4100)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("KILN_RELAY_PORT must be a valid TCP port")
  }

  const directOrigin = new URL(`https://${formatHost(hostname)}:${port}`)
  return directOrigin.hostname === browserOrigin.hostname
    ? directOrigin
    : browserOrigin
}

function formatHost(hostname: string): string {
  return hostname.includes(":") && !hostname.startsWith("[")
    ? `[${hostname}]`
    : hostname
}
