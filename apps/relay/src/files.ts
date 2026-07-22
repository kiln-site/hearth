import {
  lstat,
  open,
  opendir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { randomUUID } from "node:crypto"
import { gunzip } from "node:zlib"
import { promisify } from "node:util"

import type {
  RelayFileContent,
  RelayFileTree,
  RelayLatestLog,
  RelaySaveFileInput,
} from "@workspace/contracts"

import type { RelayConfig, RelayInstanceConfig } from "./config.js"

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_LOG_SHARE_BYTES = 10 * 1024 * 1024
const MAX_TREE_ITEMS = 5_000
const MAX_TREE_DEPTH = 10
const MAX_TRANSFER_BYTES = 20 * 1024 * 1024 * 1024
const gunzipAsync = promisify(gunzip)

export class FilesystemDriver {
  readonly #config: RelayConfig

  constructor(config: RelayConfig) {
    this.#config = config
  }

  async tree(instance: RelayInstanceConfig): Promise<RelayFileTree> {
    const root = await this.#instanceRoot(instance)
    const paths: Array<string> = []
    let truncated = false

    const visit = async (directory: string, depth: number): Promise<void> => {
      if (paths.length >= MAX_TREE_ITEMS || depth > MAX_TREE_DEPTH) {
        truncated = true
        return
      }

      const entries = []
      for await (const entry of await opendir(directory)) entries.push(entry)
      entries.sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1
        }
        return left.name.localeCompare(right.name)
      })

      for (const entry of entries) {
        if (paths.length >= MAX_TREE_ITEMS) {
          truncated = true
          break
        }
        const absolute = join(directory, entry.name)
        const path = relative(root, absolute).split(sep).join("/")
        if (entry.isDirectory()) {
          paths.push(`${path}/`)
          await visit(absolute, depth + 1)
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          paths.push(path)
        }
      }
    }

    await visit(root, 0)
    return {
      instanceId: instance.id,
      paths,
      total: paths.length,
      truncated,
    }
  }

  async read(
    instance: RelayInstanceConfig,
    requestedPath: string
  ): Promise<RelayFileContent> {
    const path = await this.#existingFile(instance, requestedPath)
    const metadata = await stat(path)
    if (metadata.size > MAX_FILE_BYTES) {
      throw new RelayFilesystemError(
        "file_too_large",
        `Files larger than ${MAX_FILE_BYTES} bytes cannot be edited`
      )
    }
    const compressed = requestedPath.toLowerCase().endsWith(".log.gz")
    if (requestedPath.toLowerCase().endsWith(".gz") && !compressed) {
      throw new RelayFilesystemError(
        "unsupported_file",
        "Only Minecraft .log.gz archives can be previewed"
      )
    }

    const source = await readFile(path)
    let decoded = source
    if (compressed) {
      try {
        decoded = await gunzipAsync(source, { maxOutputLength: MAX_FILE_BYTES })
      } catch {
        throw new RelayFilesystemError(
          "invalid_gzip",
          `The archived log is invalid or expands beyond ${MAX_FILE_BYTES} bytes`
        )
      }
    }

    let content: string
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(decoded)
    } catch {
      throw new RelayFilesystemError(
        "unsupported_file",
        "This file is binary and cannot be previewed as text"
      )
    }

    return {
      instanceId: instance.id,
      path: requestedPath,
      content,
      size: metadata.size,
      decodedSize: decoded.byteLength,
      encoding: compressed ? "gzip" : "utf8",
      readOnly: compressed,
      modifiedAt: metadata.mtime.toISOString(),
    }
  }

  async write(
    instance: RelayInstanceConfig,
    requestedPath: string,
    input: RelaySaveFileInput
  ): Promise<RelayFileContent> {
    if (requestedPath.toLowerCase().endsWith(".log.gz")) {
      throw new RelayFilesystemError("read_only", "Archived logs are read-only")
    }
    const path = await this.#existingFile(instance, requestedPath)
    const metadata = await stat(path)
    if (
      input.expectedModifiedAt &&
      metadata.mtime.toISOString() !== input.expectedModifiedAt
    ) {
      throw new RelayFilesystemError(
        "file_changed",
        "The file changed on disk after it was opened"
      )
    }

    const temporary = `${path}.hearth-${process.pid}-${Date.now()}`
    await writeFile(temporary, input.content, { mode: metadata.mode })
    try {
      await rename(temporary, path)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
    return this.read(instance, requestedPath)
  }

  async latestLog(instance: RelayInstanceConfig): Promise<RelayLatestLog> {
    const requestedPath = "logs/latest.log" as const
    const path = await this.#existingFile(instance, requestedPath)
    const metadata = await stat(path)
    if (metadata.size > MAX_LOG_SHARE_BYTES) {
      throw new RelayFilesystemError(
        "log_too_large",
        `latest.log exceeds the ${MAX_LOG_SHARE_BYTES} byte sharing limit`
      )
    }
    const source = await readFile(path)
    let content: string
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(source)
    } catch {
      throw new RelayFilesystemError(
        "unsupported_file",
        "latest.log is not valid UTF-8 text"
      )
    }

    return {
      instanceId: instance.id,
      path: requestedPath,
      content,
      size: source.byteLength,
    }
  }

  async download(
    instance: RelayInstanceConfig,
    requestedPath: string
  ): Promise<{
    absolutePath: string
    modifiedAt: string
    name: string
    size: number
  }> {
    const absolutePath = await this.#existingFile(instance, requestedPath)
    const metadata = await stat(absolutePath)
    return {
      absolutePath,
      modifiedAt: metadata.mtime.toISOString(),
      name: basename(absolutePath),
      size: metadata.size,
    }
  }

  async upload(
    instance: RelayInstanceConfig,
    requestedPath: string,
    source: AsyncIterable<Uint8Array>
  ): Promise<{ modifiedAt: string; path: string; size: number }> {
    validateRelativePath(requestedPath)
    const root = await this.#instanceRoot(instance)
    const candidate = resolve(root, requestedPath)
    ensureContained(root, candidate)
    const parent = await realpath(dirname(candidate))
    ensureContained(root, parent)
    let target = resolve(parent, basename(candidate))
    let mode = 0o644
    try {
      target = await realpath(candidate)
      ensureContained(root, target)
      const existing = await lstat(target)
      if (!existing.isFile()) {
        throw new RelayFilesystemError("not_a_file", "Path is not a file")
      }
      mode = existing.mode & 0o777
    } catch (cause) {
      if (!isMissingFile(cause)) throw cause
    }

    const temporary = resolve(parent, `.kiln-upload-${randomUUID()}`)
    const file = await open(temporary, "wx", mode)
    let size = 0
    try {
      for await (const chunk of source) {
        size += chunk.byteLength
        if (size > MAX_TRANSFER_BYTES) {
          throw new RelayFilesystemError(
            "file_too_large",
            "Upload exceeds the 20 GiB transfer limit"
          )
        }
        await file.write(chunk)
      }
      await file.sync()
      await file.close()
      await rename(temporary, target)
    } catch (cause) {
      await file.close().catch(() => undefined)
      await unlink(temporary).catch(() => undefined)
      throw cause
    }
    const metadata = await stat(target)
    return {
      modifiedAt: metadata.mtime.toISOString(),
      path: requestedPath,
      size,
    }
  }

  async #existingFile(
    instance: RelayInstanceConfig,
    requestedPath: string
  ): Promise<string> {
    validateRelativePath(requestedPath)
    const root = await this.#instanceRoot(instance)
    const candidate = await realpath(resolve(root, requestedPath))
    ensureContained(root, candidate)
    const metadata = await lstat(candidate)
    if (!metadata.isFile()) {
      throw new RelayFilesystemError("not_a_file", "Path is not a file")
    }
    return candidate
  }

  async #instanceRoot(instance: RelayInstanceConfig): Promise<string> {
    const root = await realpath(
      resolve(this.#config.rootDirectory, instance.directory)
    )
    ensureContained(this.#config.rootDirectory, root)
    return root
  }
}

function isMissingFile(cause: unknown): boolean {
  return Boolean(
    cause &&
    typeof cause === "object" &&
    "code" in cause &&
    cause.code === "ENOENT"
  )
}

export class RelayFilesystemError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function validateRelativePath(path: string): void {
  if (
    !path ||
    path.includes("\0") ||
    path.startsWith("/") ||
    path.split(/[\\/]/u).includes("..")
  ) {
    throw new RelayFilesystemError("invalid_path", "Invalid relative path")
  }
}

function ensureContained(root: string, candidate: string): void {
  const normalizedRoot = resolve(root)
  const normalizedCandidate = resolve(candidate)
  if (
    normalizedCandidate !== normalizedRoot &&
    !normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)
  ) {
    throw new RelayFilesystemError(
      "path_outside_instance",
      "Path resolves outside the instance directory"
    )
  }
}
