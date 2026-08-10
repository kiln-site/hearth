import { describe, expect, it } from "vite-plus/test"

import {
  backupObjectKey,
  isPublicS3Address,
  normalizeObjectPrefix,
  normalizeS3Endpoint,
} from "./backup-storage-s3"

describe("S3 backup storage", () => {
  it("normalizes origins and safe object prefixes", () => {
    expect(normalizeS3Endpoint(" https://s3.example.com/ ")).toBe(
      "https://s3.example.com"
    )
    expect(normalizeObjectPrefix(" /team//production/ ")).toBe(
      "team/production"
    )
    expect(() => normalizeS3Endpoint("http://s3.example.com")).toThrow()
    expect(() => normalizeS3Endpoint("https://s3.example.com/path")).toThrow()
    expect(() => normalizeObjectPrefix("team/../other")).toThrow()
    expect(() => normalizeObjectPrefix("é".repeat(300))).toThrow()
  })

  it("bounds generated keys even when target names require heavy escaping", () => {
    const key = backupObjectKey({
      backupId: "00000000-0000-4000-8000-000000000001",
      installationId: "kiln-production",
      objectPrefix: "p".repeat(512),
      relayId: "r".repeat(43),
      targetId: "é".repeat(120),
      targetKind: "instance",
    })
    expect(Buffer.byteLength(key)).toBeLessThanOrEqual(1_024)
    expect(key).toContain("/sha256-")
  })

  it("encodes generated key segments without changing the operator prefix", () => {
    expect(
      backupObjectKey({
        backupId: "00000000-0000-4000-8000-000000000001",
        installationId: "kiln.dev",
        objectPrefix: "team/backups",
        relayId: "relay/id",
        targetId: "server ../ one",
        targetKind: "instance",
      })
    ).toBe(
      "team/backups/kiln/kiln.dev/relay%2Fid/instance/server%20..%2F%20one/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000001.zip"
    )
  })

  it("rejects private, local, reserved, and invalid addresses", () => {
    expect(isPublicS3Address("8.8.8.8")).toBe(true)
    expect(isPublicS3Address("2606:4700:4700::1111")).toBe(true)
    expect(isPublicS3Address("127.0.0.1")).toBe(false)
    expect(isPublicS3Address("10.0.0.1")).toBe(false)
    expect(isPublicS3Address("169.254.169.254")).toBe(false)
    expect(isPublicS3Address("::ffff:127.0.0.1")).toBe(false)
    expect(isPublicS3Address("::ffff:7f00:1")).toBe(false)
    expect(isPublicS3Address("not-an-address")).toBe(false)
  })
})
