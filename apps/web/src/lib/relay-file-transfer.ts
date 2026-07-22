import { relayBrowserRequestProofTranscript } from "@workspace/contracts"

import { issueFileCapability } from "@/server/relay-capability"

interface FileTransferInput {
  instanceId: string
  path: string
  relayId: string
}

export async function downloadRelayFile(
  input: FileTransferInput
): Promise<void> {
  const response = await relayFileRequest(input, "GET")
  if (!response.ok) throw await transferError(response, "download")
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement("a")
    anchor.href = objectUrl
    anchor.download = input.path.split("/").filter(Boolean).at(-1) || "download"
    anchor.rel = "noopener"
    anchor.click()
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
  }
}

export async function uploadRelayFile(
  input: FileTransferInput & {
    file: File
  }
): Promise<{ modifiedAt: string; path: string; size: number }> {
  const response = await relayFileRequest(input, "PUT", input.file)
  if (!response.ok) throw await transferError(response, "upload")
  const result = (await response.json()) as unknown
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Relay returned an invalid upload response")
  }
  const value = Object.fromEntries(Object.entries(result))
  if (
    typeof value.modifiedAt !== "string" ||
    typeof value.path !== "string" ||
    typeof value.size !== "number"
  )
    throw new Error("Relay returned an invalid upload response")
  return {
    modifiedAt: value.modifiedAt,
    path: value.path,
    size: value.size,
  }
}

async function relayFileRequest(
  input: FileTransferInput,
  method: "GET" | "PUT",
  body?: BodyInit
): Promise<Response> {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  )
  const exported = await crypto.subtle.exportKey("jwk", keys.publicKey)
  const publicKeyJwk = {
    crv: "P-256" as const,
    kty: "EC" as const,
    x: requiredCoordinate(exported.x),
    y: requiredCoordinate(exported.y),
  }
  const issued = await issueFileCapability({
    data: {
      action: method === "PUT" ? "instance.files.write" : "instance.files.read",
      instanceId: input.instanceId,
      path: input.path,
      publicKeyJwk,
      relayId: input.relayId,
    },
  })
  const payload = capabilityPayload(issued.capability)
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32))
  const nonce = bytesToBase64Url(nonceBytes)
  const requestedAt = Date.now()
  const proof = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    keys.privateKey,
    new TextEncoder().encode(
      relayBrowserRequestProofTranscript({
        capabilityId: payload.capabilityId,
        expiresAt: payload.expiresAt,
        instanceId: input.instanceId,
        method,
        nonce,
        path: input.path,
        relayId: input.relayId,
        requestedAt,
      })
    )
  )
  const url = new URL(
    `/v1/browser/files/${encodeURIComponent(input.instanceId)}`,
    issued.browserOrigin
  )
  url.searchParams.set("path", input.path)
  return fetch(url, {
    ...(body === undefined ? {} : { body }),
    headers: {
      Authorization: `Kiln ${issued.capability}`,
      "X-Kiln-Nonce": nonce,
      "X-Kiln-Proof": bytesToBase64Url(new Uint8Array(proof)),
      "X-Kiln-Public-Key": bytesToBase64Url(
        new TextEncoder().encode(JSON.stringify(publicKeyJwk))
      ),
      "X-Kiln-Requested-At": String(requestedAt),
    },
    method,
    mode: "cors",
  })
}

function capabilityPayload(capability: string): {
  capabilityId: string
  expiresAt: number
} {
  const encoded = capability.split(".", 1)[0]
  if (!encoded) throw new Error("Hearth returned an invalid Relay capability")
  const value = JSON.parse(atobBase64Url(encoded)) as unknown
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Hearth returned an invalid Relay capability")
  }
  const payload = Object.fromEntries(Object.entries(value))
  if (
    typeof payload.capabilityId !== "string" ||
    typeof payload.expiresAt !== "number"
  )
    throw new Error("Hearth returned an invalid Relay capability")
  return {
    capabilityId: payload.capabilityId,
    expiresAt: payload.expiresAt,
  }
}

async function transferError(
  response: Response,
  operation: string
): Promise<Error> {
  const body = (await response.json().catch(() => null)) as unknown
  const message =
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
      ? body.error
      : `Relay ${operation} failed with HTTP ${response.status}`
  return new Error(message)
}

function requiredCoordinate(value: string | undefined): string {
  if (!value) throw new Error("Browser could not create a file transfer key")
  return value
}

function bytesToBase64Url(value: Uint8Array): string {
  let binary = ""
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "")
}

function atobBase64Url(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/")
  return atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))
}
