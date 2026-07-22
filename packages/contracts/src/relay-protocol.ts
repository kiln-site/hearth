import { Schema } from "effect"

export const relayControlProtocol = "kiln-relay.v1" as const
export const relayBrowserProtocol = "kiln-relay-browser.v1" as const
export const relayPairingProtocol = "kiln-relay-pair.v1" as const

export const relayControlOperations = [
  "relay.snapshot",
  "relay.rename",
  "relay.audit.list",
  "relay.networking.read",
  "relay.networking.write",
  "relay.proxy.read",
  "relay.proxy.write",
  "relay.pairing.create",
  "relay.pairing.list",
  "relay.pairing.revoke",
  "relay.clients.list",
  "relay.clients.update",
  "relay.clients.revoke",
  "brick.catalog",
  "brick.recipe",
  "instance.create",
  "instance.delete",
  "instance.action",
  "instance.files.list",
  "instance.files.read",
  "instance.files.write",
  "instance.console.history",
  "instance.console.write",
  "instance.console.complete",
  "instance.logs.latest",
  "instance.network.routes.read",
  "instance.network.routes.write",
  "sftp.authorization.resolve",
] as const

export type RelayControlOperation = (typeof relayControlOperations)[number]

export function relayControlDeadlineMs(
  operation: RelayControlOperation
): number {
  return operation === "instance.network.routes.write" ? 240_000 : 30_000
}

export const RelayControlOperationSchema = Schema.Literals(
  relayControlOperations
)

export const RelayAuthChallengeSchema = Schema.Struct({
  expiresAt: Schema.Number,
  nonce: Schema.String,
  relayId: Schema.String,
  sessionId: Schema.String,
  signature: Schema.String,
  type: Schema.Literal("auth.challenge"),
  v: Schema.Literal(1),
})

export const RelayAuthResponseSchema = Schema.Struct({
  clientId: Schema.String,
  signature: Schema.String,
  type: Schema.Literal("auth.response"),
  v: Schema.Literal(1),
})

export const RelayAuthReadySchema = Schema.Struct({
  actions: Schema.Array(Schema.String),
  clientId: Schema.String,
  protocol: Schema.Literal(relayControlProtocol),
  relayBuild: Schema.String,
  role: Schema.Literals(["full_access", "read_only", "custom"]),
  type: Schema.Literal("auth.ready"),
  v: Schema.Literal(1),
})

export const RelayControlRequestSchema = Schema.Struct({
  deadline: Schema.Number,
  id: Schema.String,
  operation: RelayControlOperationSchema,
  payload: Schema.Unknown,
  type: Schema.Literal("request"),
  v: Schema.Literal(1),
})

export const RelayControlCancelSchema = Schema.Struct({
  id: Schema.String,
  replyTo: Schema.String,
  type: Schema.Literal("cancel"),
  v: Schema.Literal(1),
})

export const RelayControlResponseSchema = Schema.Struct({
  id: Schema.String,
  payload: Schema.Unknown,
  replyTo: Schema.String,
  type: Schema.Literal("response"),
  v: Schema.Literal(1),
})

export const RelayControlErrorSchema = Schema.Struct({
  code: Schema.String,
  id: Schema.String,
  message: Schema.String,
  replyTo: Schema.NullOr(Schema.String),
  retryable: Schema.Boolean,
  type: Schema.Literal("error"),
  v: Schema.Literal(1),
})

export const RelayControlEventSchema = Schema.Struct({
  event: Schema.String,
  id: Schema.String,
  payload: Schema.Unknown,
  seq: Schema.Number,
  type: Schema.Literal("event"),
  v: Schema.Literal(1),
})

export const RelayControlClientMessageSchema = Schema.Union([
  RelayAuthResponseSchema,
  RelayControlRequestSchema,
  RelayControlCancelSchema,
  RelayControlResponseSchema,
  RelayControlErrorSchema,
])

export const RelayControlServerMessageSchema = Schema.Union([
  RelayAuthChallengeSchema,
  RelayAuthReadySchema,
  RelayControlResponseSchema,
  RelayControlErrorSchema,
  RelayControlEventSchema,
  RelayControlRequestSchema,
])

export type RelayAuthChallenge = typeof RelayAuthChallengeSchema.Type
export type RelayAuthResponse = typeof RelayAuthResponseSchema.Type
export type RelayAuthReady = typeof RelayAuthReadySchema.Type
export type RelayControlRequest = typeof RelayControlRequestSchema.Type
export type RelayControlCancel = typeof RelayControlCancelSchema.Type
export type RelayControlResponse = typeof RelayControlResponseSchema.Type
export type RelayControlError = typeof RelayControlErrorSchema.Type
export type RelayControlEvent = typeof RelayControlEventSchema.Type
export type RelayControlClientMessage =
  typeof RelayControlClientMessageSchema.Type
export type RelayControlServerMessage =
  typeof RelayControlServerMessageSchema.Type

export function relayAuthChallengeTranscript(
  challenge: Omit<RelayAuthChallenge, "signature">
): string {
  return JSON.stringify([
    relayControlProtocol,
    "challenge",
    challenge.relayId,
    challenge.sessionId,
    challenge.nonce,
    challenge.expiresAt,
  ])
}

export function relayAuthResponseTranscript(
  challenge: Omit<RelayAuthChallenge, "signature">,
  clientId: string
): string {
  return JSON.stringify([
    relayControlProtocol,
    "response",
    challenge.relayId,
    clientId,
    challenge.sessionId,
    challenge.nonce,
    challenge.expiresAt,
  ])
}

export interface RelayPairingRequestContract {
  readonly bootstrapProof: string | null
  readonly hearthName: string
  readonly hearthOrigin: string
  readonly invitationId: string
  readonly nonce: string
  readonly publicKeyPem: string
  readonly signature: string
  readonly token: string | null
  readonly version: 1
}

export interface RelayPairingResponseContract {
  readonly actions: ReadonlyArray<string>
  readonly clientId: string
  readonly expiresAt: number
  readonly nonce: string
  readonly relayFingerprint: string
  readonly relayName: string
  readonly relayPublicKeyPem: string
  readonly role: "custom" | "full_access" | "read_only"
  readonly signature: string
  readonly version: 1
}

export function relayPairingRequestTranscript(
  request: RelayPairingRequestContract
): string {
  return JSON.stringify([
    relayPairingProtocol,
    "request",
    request.invitationId,
    request.token
      ? ["token", request.token]
      : ["bootstrap", request.bootstrapProof],
    request.hearthName,
    new URL(request.hearthOrigin).origin,
    request.nonce,
    request.publicKeyPem,
  ])
}

export function relayBootstrapDiscoveryTranscript(input: {
  readonly clientNonce: string
  readonly controlEndpoint: string
  readonly expiresAt: number
  readonly invitationId: string
  readonly relayFingerprint: string
  readonly relayPublicKeyPem: string
  readonly serverNonce: string
  readonly tlsFingerprint: string
}): string {
  return JSON.stringify([
    relayPairingProtocol,
    "bootstrap-discovery",
    input.clientNonce,
    input.serverNonce,
    input.tlsFingerprint,
    input.relayFingerprint,
    input.relayPublicKeyPem,
    input.controlEndpoint,
    input.invitationId,
    input.expiresAt,
  ])
}

export function relayBootstrapEnrollmentTranscript(
  request: Pick<
    RelayPairingRequestContract,
    | "hearthName"
    | "hearthOrigin"
    | "invitationId"
    | "nonce"
    | "publicKeyPem"
    | "version"
  >
): string {
  return JSON.stringify([
    relayPairingProtocol,
    "bootstrap-enrollment",
    request.invitationId,
    request.hearthName,
    new URL(request.hearthOrigin).origin,
    request.nonce,
    request.publicKeyPem,
  ])
}

export function relayPairingResponseTranscript(
  response: Omit<RelayPairingResponseContract, "signature">
): string {
  return JSON.stringify([
    relayPairingProtocol,
    "response",
    response.clientId,
    response.relayFingerprint,
    response.relayName,
    response.relayPublicKeyPem,
    response.role,
    response.actions,
    response.nonce,
    response.expiresAt,
  ])
}

export function relayBrowserProofTranscript(input: {
  readonly capabilityId: string
  readonly expiresAt: number
  readonly nonce: string
  readonly relayId: string
  readonly sessionId: string
}): string {
  return JSON.stringify([
    relayBrowserProtocol,
    "proof",
    input.relayId,
    input.sessionId,
    input.nonce,
    input.expiresAt,
    input.capabilityId,
  ])
}

export function relayBrowserRequestProofTranscript(input: {
  readonly capabilityId: string
  readonly expiresAt: number
  readonly instanceId: string
  readonly method: "GET" | "HEAD" | "PUT"
  readonly nonce: string
  readonly path: string
  readonly relayId: string
  readonly requestedAt: number
}): string {
  return JSON.stringify([
    relayBrowserProtocol,
    "request-proof",
    input.relayId,
    input.capabilityId,
    input.expiresAt,
    input.method,
    input.instanceId,
    input.path,
    input.nonce,
    input.requestedAt,
  ])
}
