import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto"

const CIPHERTEXT_FORMAT = "v1"
const KEY_LENGTH = 32
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const KEYRING_SALT = Buffer.from("kiln-keyring-v1", "utf8")

export function parseSecretKeyring(
  configured,
  environmentName = "BETTER_AUTH_SECRETS"
) {
  if (!configured?.trim()) {
    throw new Error(
      `${environmentName} is required and must contain at least one versioned secret`
    )
  }

  const seenVersions = new Set()
  const keyring = configured.split(",").map((rawEntry) => {
    const entry = rawEntry.trim()
    const separator = entry.indexOf(":")
    if (separator < 1) {
      throw new Error(
        `${environmentName} entries must use the format <version>:<secret>`
      )
    }

    const encodedVersion = entry.slice(0, separator)
    if (!/^(?:0|[1-9]\d*)$/u.test(encodedVersion)) {
      throw new Error(
        `${environmentName} versions must be non-negative integers`
      )
    }
    const version = Number(encodedVersion)
    if (!Number.isSafeInteger(version)) {
      throw new Error(`${environmentName} versions must be safe integers`)
    }
    if (seenVersions.has(version)) {
      throw new Error(
        `${environmentName} contains duplicate version ${version}`
      )
    }
    seenVersions.add(version)

    const value = entry.slice(separator + 1).trim()
    if (value.length < 32) {
      throw new Error(
        `${environmentName} secret version ${version} must contain at least 32 characters`
      )
    }
    return { version, value }
  })

  if (keyring.length === 0) {
    throw new Error(`${environmentName} must contain at least one secret`)
  }
  return keyring
}

export function encryptWithKeyring(plaintext, keyring, purpose) {
  assertKeyring(keyring)
  assertPurpose(purpose)
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("Encrypted values must be non-empty strings")
  }

  const current = keyring[0]
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveKey(current.value, purpose),
    iv
  )
  cipher.setAAD(authenticatedContext(current.version, purpose))
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  return [
    CIPHERTEXT_FORMAT,
    String(current.version),
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".")
}

export function decryptWithKeyring(encoded, keyring, purpose) {
  assertKeyring(keyring)
  assertPurpose(purpose)
  if (typeof encoded !== "string") {
    throw new Error("Encrypted value is invalid")
  }

  const parts = encoded.split(".")
  if (parts.length !== 5 || parts[0] !== CIPHERTEXT_FORMAT) {
    throw new Error("Encrypted value format is invalid")
  }
  const [, encodedVersion, encodedIv, encodedTag, encodedCiphertext] = parts
  if (!/^(?:0|[1-9]\d*)$/u.test(encodedVersion)) {
    throw new Error("Encrypted value key version is invalid")
  }
  const version = Number(encodedVersion)
  if (!Number.isSafeInteger(version)) {
    throw new Error("Encrypted value key version is invalid")
  }
  const secret = keyring.find((entry) => entry.version === version)
  if (!secret) {
    throw new Error(
      `Encrypted value requires unavailable key version ${version}`
    )
  }

  const iv = decodeComponent(encodedIv, IV_LENGTH)
  const tag = decodeComponent(encodedTag, AUTH_TAG_LENGTH)
  const ciphertext = decodeComponent(encodedCiphertext)
  if (ciphertext.length === 0) throw new Error("Encrypted value is invalid")

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret.value, purpose),
    iv
  )
  decipher.setAAD(authenticatedContext(version, purpose))
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8")
  return {
    needsRotation: version !== keyring[0].version,
    plaintext,
    version,
  }
}

function assertKeyring(keyring) {
  if (!Array.isArray(keyring) || keyring.length === 0) {
    throw new Error("A non-empty secret keyring is required")
  }
}

function assertPurpose(purpose) {
  if (typeof purpose !== "string" || purpose.length === 0) {
    throw new Error("An encryption purpose is required")
  }
}

function deriveKey(secret, purpose) {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      KEYRING_SALT,
      Buffer.from(purpose, "utf8"),
      KEY_LENGTH
    )
  )
}

function authenticatedContext(version, purpose) {
  return Buffer.from(`${CIPHERTEXT_FORMAT}\0${version}\0${purpose}`, "utf8")
}

function decodeComponent(value, expectedLength) {
  if (!value || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("Encrypted value is invalid")
  }
  const decoded = Buffer.from(value, "base64url")
  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    throw new Error("Encrypted value is invalid")
  }
  return decoded
}
