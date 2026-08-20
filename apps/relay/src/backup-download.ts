import { randomUUID, verify } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat } from "node:fs/promises"
import { resolve } from "node:path"
import { pipeline } from "node:stream/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { Effect, Result } from "effect"

import { backupDownloadCapabilityPayloadSchema } from "@workspace/contracts"

import type { RelayConfig } from "./config.js"
import type { RelayIdentity } from "./effect/identity.js"
import type { RelayStateStore } from "./effect/state.js"
import { actionsForRole } from "./permissions.js"

const MAX_ACTIVE_DOWNLOADS = 4
const MAX_TOKEN_BYTES = 16 * 1024
const MAX_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60_000

export class BackupDownloadServer {
  #active = 0
  readonly #config: RelayConfig
  readonly #identity: RelayIdentity
  readonly #runEffect: <T, E>(effect: Effect.Effect<T, E>) => Promise<T>
  readonly #state: RelayStateStore["Service"]

  constructor(options: {
    config: RelayConfig
    identity: RelayIdentity
    runEffect: <T, E>(effect: Effect.Effect<T, E>) => Promise<T>
    state: RelayStateStore["Service"]
  }) {
    this.#config = options.config
    this.#identity = options.identity
    this.#runEffect = options.runEffect
    this.#state = options.state
  }

  async handleRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<boolean> {
    const url = new URL(request.url ?? "/", "http://relay")
    const match = url.pathname.match(/^\/v1\/browser\/backups\/([^/]+)$/u)
    if (!match) return false
    if (request.method !== "GET" && request.method !== "HEAD") {
      json(response, 405, { error: "Method not allowed" })
      return true
    }
    if (this.#active >= MAX_ACTIVE_DOWNLOADS) {
      json(response, 429, { error: "Relay backup download capacity reached" })
      return true
    }
    this.#active += 1
    const result = await Effect.runPromise(
      Effect.result(
        Effect.tryPromise({
          try: () =>
            this.#download(
              request,
              response,
              decodeURIComponent(match[1] ?? ""),
              url.searchParams.get("token") ?? ""
            ),
          catch: (cause) => cause,
        })
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.#active -= 1
          })
        )
      )
    )
    if (Result.isFailure(result)) {
      const cause = result.failure
      if (response.headersSent) {
        response.destroy(cause instanceof Error ? cause : undefined)
      } else {
        json(response, 401, { error: "Backup download link is invalid" })
      }
    }
    return true
  }

  async #download(
    request: IncomingMessage,
    response: ServerResponse,
    backupId: string,
    token: string
  ): Promise<void> {
    const capability = await this.#authenticate(backupId, token)
    const archivePath = resolve(
      this.#config.dataDirectory,
      "backups",
      `${capability.backupId}.zip`
    )
    const exportPath = resolve(
      this.#config.dataDirectory,
      "exports",
      `${capability.backupId}.zip`
    )
    const archive = await optionalLstat(archivePath)
    const exported = await optionalLstat(exportPath)
    const selected =
      archive?.isFile() && !archive.isSymbolicLink()
        ? { metadata: archive, path: archivePath }
        : exported?.isFile() && !exported.isSymbolicLink()
          ? { metadata: exported, path: exportPath }
          : null
    if (!selected) {
      throw new Error("Backup archive is unavailable")
    }
    const metadata = selected.metadata
    const range = parseRange(request.headers.range, metadata.size)
    const headers: Record<string, string> = {
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers":
        "Accept-Ranges, Content-Disposition, Content-Length, Content-Range",
      "Cache-Control": "private, no-store",
      "Content-Disposition": contentDisposition(capability.filename),
      "Content-Length": String(
        range ? range.end - range.start + 1 : metadata.size
      ),
      "Content-Type": "application/zip",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...(range
        ? {
            "Content-Range": `bytes ${range.start}-${range.end}/${metadata.size}`,
          }
        : {}),
    }
    response.writeHead(range ? 206 : 200, headers)
    if (request.method === "HEAD") {
      response.end()
      return
    }
    let transferred = 0
    const stream = createReadStream(selected.path, range ?? undefined)
    stream.on("data", (chunk) => {
      transferred += Buffer.byteLength(chunk)
    })
    const result = await Effect.runPromise(
      Effect.result(
        Effect.tryPromise({
          try: () => pipeline(stream, response),
          catch: (cause) => cause,
        })
      )
    )
    await this.#runEffect(
      this.#state
        .appendAudit({
          clientId: capability.issuer,
          details: {
            backupId: capability.backupId,
            bytes: transferred,
            outcome: Result.isFailure(result) ? "aborted" : "completed",
            permission: "backup.download",
            subject: capability.subject,
          },
          event: "browser.backup.download",
          id: randomUUID(),
          occurredAt: Date.now(),
          requestId: capability.capabilityId,
        })
        .pipe(Effect.ignore)
    )
    if (Result.isFailure(result)) {
      throw result.failure
    }
  }

  async #authenticate(backupId: string, token: string) {
    if (!token || Buffer.byteLength(token) > MAX_TOKEN_BYTES) {
      throw new Error("Backup capability is missing")
    }
    const parts = token.split(".")
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error("Backup capability is malformed")
    }
    const payload = backupDownloadCapabilityPayloadSchema.parse(
      JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as unknown
    )
    const now = Date.now()
    if (
      payload.backupId !== backupId ||
      payload.audience !== this.#identity.fingerprint ||
      payload.expiresAt <= now ||
      payload.issuedAt > now + 5_000 ||
      payload.expiresAt - payload.issuedAt > MAX_TOKEN_LIFETIME_MS
    ) {
      throw new Error("Backup capability scope is invalid")
    }
    const client = await this.#runEffect(
      this.#state.findClientById(payload.issuer)
    )
    if (
      !client ||
      !actionsForRole(client.role, client.actions).includes("backup.download")
    ) {
      throw new Error("Backup capability issuer is unavailable")
    }
    if (
      !verify(
        null,
        Buffer.from(parts[0]),
        client.publicKey,
        Buffer.from(parts[1], "base64url")
      )
    ) {
      throw new Error("Backup capability signature is invalid")
    }
    return payload
  }
}

function optionalLstat(path: string) {
  return Effect.runPromise(
    Effect.result(
      Effect.tryPromise({
        try: () => lstat(path),
        catch: (cause) => cause,
      })
    )
  ).then((result) => (Result.isSuccess(result) ? result.success : null))
}

function parseRange(
  value: string | undefined,
  size: number
): { end: number; start: number } | null {
  if (!value) return null
  const match = /^bytes=(\d+)-(\d*)$/u.exec(value.trim())
  if (!match?.[1]) throw new Error("Invalid download range")
  const start = Number(match[1])
  const end = match[2] ? Number(match[2]) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end >= size
  ) {
    throw new Error("Invalid download range")
  }
  return { end, start }
}

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^A-Za-z0-9._-]/gu, "_") || "backup.zip"
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

function json(
  response: ServerResponse,
  status: number,
  value: Readonly<Record<string, unknown>>
): void {
  response
    .writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    })
    .end(JSON.stringify(value))
}
