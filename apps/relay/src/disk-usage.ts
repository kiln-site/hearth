import { lstat, opendir, stat } from "node:fs/promises"
import { join } from "node:path"

export async function directoryApparentSize(root: string): Promise<number> {
  const rootMetadata = await stat(root)
  const rootDevice = rootMetadata.dev
  const hardLinks = new Set<string>()

  async function visit(directory: string): Promise<number> {
    let total = 0
    let entries
    try {
      entries = await opendir(directory)
    } catch (cause) {
      if (isMissingPath(cause)) return 0
      throw cause
    }

    for await (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        let metadata
        try {
          metadata = await lstat(path)
        } catch (cause) {
          if (isMissingPath(cause)) continue
          throw cause
        }
        if (metadata.dev === rootDevice) total += await visit(path)
        continue
      }
      if (!entry.isFile()) continue

      let metadata
      try {
        metadata = await lstat(path)
      } catch (cause) {
        if (isMissingPath(cause)) continue
        throw cause
      }
      if (metadata.dev !== rootDevice) continue
      if (metadata.nlink > 1) {
        const key = `${metadata.dev}:${metadata.ino}`
        if (hardLinks.has(key)) continue
        hardLinks.add(key)
      }
      total += metadata.size
    }
    return total
  }

  return visit(root)
}

function isMissingPath(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    "code" in cause &&
    (cause.code === "ENOENT" || cause.code === "ENOTDIR")
  )
}
