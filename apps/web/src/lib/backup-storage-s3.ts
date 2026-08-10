import { createHash, randomUUID } from "node:crypto"
import { lookup } from "node:dns"
import { Agent } from "node:https"
import { BlockList, isIP } from "node:net"
import type { LookupFunction } from "node:net"

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NodeHttpHandler } from "@smithy/node-http-handler"
import { Effect, Result } from "effect"

import { BackupStorageError } from "@/effect/errors"

const CONNECTION_TEST_PREFIX = "kiln/connection-tests"
const PRESIGNED_UPLOAD_SECONDS = 7 * 24 * 60 * 60
const PRESIGNED_DOWNLOAD_SECONDS = 5 * 60
const BLOCKED_ADDRESSES = new BlockList()
const BLOCKED_IPV4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]
const BLOCKED_IPV6: ReadonlyArray<readonly [string, number]> = [
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:10::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
]

for (const [network, prefix] of BLOCKED_IPV4) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, "ipv4")
}
for (const [network, prefix] of BLOCKED_IPV6) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, "ipv6")
}

export interface S3BackupCredential {
  accessKeyId: string
  allowPrivateNetwork: boolean
  bucket: string
  endpoint: string
  forcePathStyle: boolean
  objectPrefix: string
  region: string
  secretAccessKey: string
}

export function normalizeS3Endpoint(value: string): string {
  const parsed = Result.try(() => new URL(value.trim()))
  if (Result.isFailure(parsed)) {
    throw backupStorageError(
      "invalid_endpoint",
      "storage.validate",
      "The S3 endpoint must be an absolute HTTPS URL",
      parsed.failure
    )
  }
  const endpoint = parsed.success
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.pathname !== "/" && endpoint.pathname !== "")
  ) {
    throw backupStorageError(
      "invalid_endpoint",
      "storage.validate",
      "The S3 endpoint must be an HTTPS origin without credentials, a path, query, or fragment"
    )
  }
  return endpoint.origin
}

export function normalizeObjectPrefix(value: string): string {
  const normalized = value
    .trim()
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\/{2,}/gu, "/")
  if (!normalized) return ""
  if (
    Buffer.byteLength(normalized) > 512 ||
    normalized
      .split("/")
      .some((segment) => segment === "." || segment === "..") ||
    Array.from(normalized).some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code < 32 || code === 127
    })
  ) {
    throw backupStorageError(
      "invalid_prefix",
      "storage.validate",
      "The object prefix must be a safe relative S3 key prefix"
    )
  }
  return normalized
}

export function backupObjectKey(input: {
  backupId: string
  installationId: string
  objectPrefix: string
  relayId: string
  targetId: string
  targetKind: "database" | "instance" | "platform"
}): string {
  return [
    input.objectPrefix,
    "kiln",
    objectKeySegment(input.installationId),
    objectKeySegment(input.relayId),
    input.targetKind,
    objectKeySegment(input.targetId),
    objectKeySegment(input.backupId),
    `${objectKeySegment(input.backupId)}.zip`,
  ]
    .filter(Boolean)
    .join("/")
}

export function verifyS3BackupCredential(credential: S3BackupCredential) {
  const objectKey = [
    credential.objectPrefix,
    CONNECTION_TEST_PREFIX,
    `${randomUUID()}.probe`,
  ]
    .filter(Boolean)
    .join("/")
  return withS3Client(credential, (client) =>
    Effect.acquireUseRelease(
      s3Request("storage.verify.put", () =>
        client.send(
          new PutObjectCommand({
            Body: new Uint8Array(),
            Bucket: credential.bucket,
            ContentType: "application/octet-stream",
            Key: objectKey,
          })
        )
      ),
      () =>
        s3Request("storage.verify.head", () =>
          client.send(
            new HeadObjectCommand({
              Bucket: credential.bucket,
              Key: objectKey,
            })
          )
        ),
      () =>
        s3Request("storage.verify.delete", () =>
          client.send(
            new DeleteObjectCommand({
              Bucket: credential.bucket,
              Key: objectKey,
            })
          )
        ).pipe(Effect.ignore)
    ).pipe(Effect.asVoid)
  )
}

export function signS3BackupUpload(
  credential: S3BackupCredential,
  objectKey: string
) {
  return withS3Client(credential, (client) =>
    s3Request("storage.signUpload", () =>
      getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: credential.bucket,
          ContentType: "application/zip",
          Key: objectKey,
        }),
        { expiresIn: PRESIGNED_UPLOAD_SECONDS }
      )
    ).pipe(
      Effect.map((uploadUrl) => ({
        allowPrivateNetwork: credential.allowPrivateNetwork,
        headers: { "content-type": "application/zip" },
        kind: "s3" as const,
        objectKey,
        uploadUrl,
      }))
    )
  )
}

export function signS3BackupDelete(
  credential: S3BackupCredential,
  objectKey: string
) {
  return withS3Client(credential, (client) =>
    s3Request("storage.signDelete", () =>
      getSignedUrl(
        client,
        new DeleteObjectCommand({
          Bucket: credential.bucket,
          Key: objectKey,
        }),
        { expiresIn: PRESIGNED_UPLOAD_SECONDS }
      )
    ).pipe(
      Effect.map((deleteUrl) => ({
        allowPrivateNetwork: credential.allowPrivateNetwork,
        deleteUrl,
        headers: {},
        kind: "s3" as const,
        objectKey,
      }))
    )
  )
}

export function signS3BackupDownload(
  credential: S3BackupCredential,
  objectKey: string,
  filename: string
) {
  return withS3Client(credential, (client) =>
    s3Request("storage.signDownload", () =>
      getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: credential.bucket,
          Key: objectKey,
          ResponseContentDisposition: `attachment; filename="${filename.replace(/["\\\r\n]/gu, "_")}"`,
        }),
        { expiresIn: PRESIGNED_DOWNLOAD_SECONDS }
      )
    ).pipe(
      Effect.map((url) => ({
        expiresAt: new Date(
          Date.now() + PRESIGNED_DOWNLOAD_SECONDS * 1_000
        ).toISOString(),
        url,
      }))
    )
  )
}

function withS3Client<TResult, TError, TRequirements>(
  credential: S3BackupCredential,
  use: (client: S3Client) => Effect.Effect<TResult, TError, TRequirements>
) {
  return Effect.acquireUseRelease(
    Effect.try({
      try: () => makeS3Client(credential),
      catch: (cause) =>
        backupStorageError(
          "invalid_s3_client",
          "storage.connect",
          "The S3 client could not be configured",
          cause
        ),
    }),
    use,
    (client) =>
      Effect.sync(() => {
        client.destroy()
      })
  )
}

function makeS3Client(credential: S3BackupCredential): S3Client {
  const endpoint = normalizeS3Endpoint(credential.endpoint)
  const endpointHost = new URL(endpoint).hostname.replace(/^\[|\]$/gu, "")
  if (
    !credential.allowPrivateNetwork &&
    isIP(endpointHost) !== 0 &&
    !isPublicS3Address(endpointHost)
  ) {
    throw backupStorageError(
      "blocked_endpoint",
      "storage.connect",
      "The S3 endpoint resolves to a private or reserved network address"
    )
  }
  const requestHandler = credential.allowPrivateNetwork
    ? undefined
    : new NodeHttpHandler({
        connectionTimeout: 10_000,
        httpsAgent: new Agent({ lookup: publicS3Lookup }),
        requestTimeout: 30_000,
      })
  return new S3Client({
    credentials: {
      accessKeyId: credential.accessKeyId,
      secretAccessKey: credential.secretAccessKey,
    },
    endpoint,
    forcePathStyle: credential.forcePathStyle,
    region: credential.region,
    ...(requestHandler === undefined ? {} : { requestHandler }),
  })
}

function objectKeySegment(value: string): string {
  const encoded = encodeURIComponent(value)
  if (encoded.length <= 180) return encoded
  return `sha256-${createHash("sha256").update(value).digest("hex")}`
}

const publicS3Lookup: LookupFunction = (hostname, options, callback) => {
  lookup(
    hostname,
    {
      all: true,
      family: options.family,
      hints: options.hints,
      order: options.order ?? "verbatim",
    },
    (cause, addresses) => {
      if (cause) {
        callback(cause, "")
        return
      }
      const blocked = addresses.find(
        ({ address }) => !isPublicS3Address(address)
      )
      if (blocked) {
        callback(
          backupStorageError(
            "blocked_endpoint",
            "storage.connect",
            "The S3 endpoint resolves to a private or reserved network address"
          ),
          ""
        )
        return
      }
      const selected = addresses.at(0)
      if (!selected) {
        callback(new Error("The S3 endpoint did not resolve to an address"), "")
        return
      }
      if (options.all) callback(null, addresses)
      else callback(null, selected.address, selected.family)
    }
  )
}

export function isPublicS3Address(address: string): boolean {
  const normalized = normalizePeerAddress(address)
  const family = isIP(normalized)
  return (
    family !== 0 &&
    !BLOCKED_ADDRESSES.check(normalized, family === 4 ? "ipv4" : "ipv6")
  )
}

function normalizePeerAddress(value: string): string {
  const withoutZone = value.split("%", 1)[0] ?? value
  const mappedIpv4 = withoutZone.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)
  if (mappedIpv4?.[1]) return mappedIpv4[1]
  if (isIP(withoutZone) !== 6) return withoutZone
  return Result.try(() => {
    const hostname = new URL(`http://[${withoutZone}]/`).hostname.slice(1, -1)
    const mappedHex = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/iu.exec(hostname)
    if (!mappedHex?.[1] || !mappedHex[2]) return withoutZone
    const high = Number.parseInt(mappedHex[1], 16)
    const low = Number.parseInt(mappedHex[2], 16)
    return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`
  }).pipe(Result.getOrElse(() => withoutZone))
}

function s3Request<TResult>(
  operation: string,
  request: () => Promise<TResult>
) {
  return Effect.tryPromise({
    try: request,
    catch: (cause) =>
      backupStorageError(
        "s3_request_failed",
        operation,
        "The S3-compatible storage request failed. Check the endpoint, region, bucket, credentials, and key permissions.",
        cause
      ),
  })
}

function backupStorageError(
  code: string,
  operation: string,
  reason: string,
  cause?: unknown
) {
  return BackupStorageError.make({
    code,
    operation,
    reason,
    ...(cause === undefined ? {} : { cause }),
  })
}
