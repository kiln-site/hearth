import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto"
import { chmod, mkdir, open, readFile, rename } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Effect, Schema } from "effect"

import { RelayIdentityError } from "./errors.js"
import type { RelayConfig } from "../config.js"

export interface RelayIdentity {
  readonly fingerprint: string
  readonly name: string
  readonly privateKeyPem: string
  readonly publicKeyPem: string
}

const StoredRelayIdentitySchema = Schema.Struct({
  name: Schema.String,
  publicKeyPem: Schema.String,
  version: Schema.Literal(1),
})

export const loadOrCreateRelayIdentity = Effect.fn(
  "RelayIdentity.loadOrCreate"
)(function* (config: RelayConfig) {
  const identityDirectory = join(config.dataDirectory, "network", "identity")
  const identityPath = join(identityDirectory, "identity.json")
  const privateKeyPath = join(identityDirectory, "identity.key")

  yield* tryPromise("create_directory", () =>
    mkdir(identityDirectory, { recursive: true, mode: 0o700 })
  )

  const loaded = yield* loadExisting(identityPath, privateKeyPath).pipe(
    Effect.catchIf(
      (error) => error.operation === "identity_missing",
      () => createIdentity(config.nodeName, identityPath, privateKeyPath)
    )
  )

  return {
    ...loaded,
    fingerprint: fingerprint(loaded.publicKeyPem),
  } satisfies RelayIdentity
})

const loadExisting = Effect.fn("RelayIdentity.loadExisting")(function* (
  identityPath: string,
  privateKeyPath: string
) {
  const files = yield* Effect.tryPromise({
    try: () =>
      Promise.all([
        readFile(identityPath, "utf8"),
        readFile(privateKeyPath, "utf8"),
      ]),
    catch: (cause) => cause,
  }).pipe(
    Effect.mapError((cause) =>
      RelayIdentityError.make({
        operation: isMissingFile(cause) ? "identity_missing" : "read_identity",
        cause,
      })
    )
  )

  const stored = yield* Effect.try({
    try: () => JSON.parse(files[0]) as unknown,
    catch: (cause) =>
      RelayIdentityError.make({ operation: "parse_identity", cause }),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(StoredRelayIdentitySchema)),
    Effect.mapError((cause) =>
      cause instanceof RelayIdentityError
        ? cause
        : RelayIdentityError.make({ operation: "decode_identity", cause })
    )
  )

  yield* Effect.try({
    try: () => {
      const privateKey = createPrivateKey(files[1])
      const derivedPublicKey = createPublicKey(privateKey).export({
        format: "pem",
        type: "spki",
      })
      if (derivedPublicKey !== stored.publicKeyPem) {
        throw new Error("Relay identity public and private keys do not match")
      }
    },
    catch: (cause) =>
      RelayIdentityError.make({ operation: "validate_identity", cause }),
  })
  yield* tryPromise("protect_private_key", () => chmod(privateKeyPath, 0o600))

  return {
    name: stored.name,
    privateKeyPem: files[1],
    publicKeyPem: stored.publicKeyPem,
  }
})

const createIdentity = Effect.fn("RelayIdentity.create")(function* (
  configuredName: string,
  identityPath: string,
  privateKeyPath: string
) {
  const keys = yield* Effect.try({
    try: () =>
      generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      }),
    catch: (cause) =>
      RelayIdentityError.make({ operation: "generate_identity", cause }),
  })
  const name = normalizeName(configuredName)
  yield* writeFileAtomic(privateKeyPath, keys.privateKey, 0o600)
  yield* writeFileAtomic(
    identityPath,
    `${JSON.stringify({ name, publicKeyPem: keys.publicKey, version: 1 })}\n`,
    0o600
  )
  return {
    name,
    privateKeyPem: keys.privateKey,
    publicKeyPem: keys.publicKey,
  }
})

export function fingerprint(publicKeyPem: string): string {
  return createHash("sha256")
    .update(
      createPublicKey(publicKeyPem).export({ format: "der", type: "spki" })
    )
    .digest("base64url")
}

function normalizeName(configuredName: string): string {
  const name = configuredName.trim()
  if (name && name !== "Kiln Relay") return name
  return `K${randomBytes(2).toString("hex").slice(0, 3).toUpperCase()}`
}

function writeFileAtomic(path: string, value: string, mode: number) {
  return tryPromise("write_identity", async () => {
    const temporaryPath = join(dirname(path), `.${randomUUID()}.tmp`)
    const file = await open(temporaryPath, "wx", mode)
    try {
      await file.writeFile(value, "utf8")
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporaryPath, path)
    const directory = await open(dirname(path), "r")
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  })
}

function tryPromise<T>(operation: string, run: () => Promise<T>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => RelayIdentityError.make({ operation, cause }),
  }).pipe(Effect.withSpan(`relay.identity.${operation}`))
}

function isMissingFile(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    "code" in cause &&
    (cause as NodeJS.ErrnoException).code === "ENOENT"
  )
}
