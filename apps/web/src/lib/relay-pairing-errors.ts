export const RELAY_PAIRING_DOCS_HREF = "https://docs.kiln.site/"

export const PAIRING_EDGE_MESSAGES = {
  untrustedTls:
    "Hostname TLS is untrusted. Check that DNS points at your Relay.",
  cloudflareNestedSsl:
    "Cloudflare SSL failed for this nested subdomain.",
  cloudflareOriginCert:
    "Cloudflare rejected the origin certificate (526).",
  cloudflareRedirect:
    "Relay URL redirected instead of pairing. Check Cloudflare SSL mode.",
} as const

const pairingEdgeMessageSet = new Set<string>(
  Object.values(PAIRING_EDGE_MESSAGES)
)

export function pairingEdgeDocsHref(message: string): string | undefined {
  return pairingEdgeMessageSet.has(message)
    ? RELAY_PAIRING_DOCS_HREF
    : undefined
}

export function pairingFeedbackFrom(
  cause: unknown,
  fallback = "Could not add Relay"
): {
  docsHref?: string
  message: string
} {
  const raw = cause instanceof Error ? cause.message : fallback
  const mapped =
    mapPairingHttpResponse(0, raw)?.message ??
    mapPairingTransportError(cause)?.message ??
    raw
  return {
    message: mapped,
    docsHref: pairingEdgeDocsHref(mapped),
  }
}

export function mapPairingTransportError(cause: unknown): Error | null {
  const code = errorCode(cause)
  const message = errorMessage(cause)

  if (
    code === "ERR_SSL_VERSION_OR_CIPHER_MISMATCH" ||
    /ssl.?version.?or.?cipher.?mismatch/i.test(message)
  ) {
    return new Error(PAIRING_EDGE_MESSAGES.cloudflareNestedSsl)
  }

  if (
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "CERT_HAS_EXPIRED" ||
    code === "ERR_TLS_CERT_ALTNAME_INVALID" ||
    /self-signed certificate/i.test(message) ||
    /unable to verify the first certificate/i.test(message) ||
    /certificate has expired/i.test(message)
  ) {
    return new Error(PAIRING_EDGE_MESSAGES.untrustedTls)
  }

  return null
}

export function mapPairingHttpResponse(
  statusCode: number,
  body: string
): Error | null {
  const trimmed = body.trim()
  const cloudflareCode = trimmed.match(/error code:\s*(\d{3})/i)?.[1]

  if (cloudflareCode === "526" || statusCode === 526) {
    return new Error(PAIRING_EDGE_MESSAGES.cloudflareOriginCert)
  }

  if (
    cloudflareCode === "525" ||
    statusCode === 525 ||
    /ERR_SSL_VERSION_OR_CIPHER_MISMATCH/i.test(trimmed)
  ) {
    return new Error(PAIRING_EDGE_MESSAGES.cloudflareNestedSsl)
  }

  if (statusCode >= 300 && statusCode < 400) {
    return new Error(PAIRING_EDGE_MESSAGES.cloudflareRedirect)
  }

  if (/temporary redirect|permanent redirect|moved permanently/i.test(trimmed)) {
    return new Error(PAIRING_EDGE_MESSAGES.cloudflareRedirect)
  }

  return null
}

function errorCode(cause: unknown): string | null {
  if (!cause || typeof cause !== "object" || !("code" in cause)) return null
  return typeof cause.code === "string" ? cause.code : null
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause ?? "")
}
