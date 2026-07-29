import { createHash } from "node:crypto"
import { resolve } from "node:path"

export function developmentRelayName(worktreePath) {
  const shortId = createHash("sha256")
    .update(resolve(worktreePath))
    .digest("hex")
    .slice(0, 8)
  return `D001-${shortId}`
}

export function ensureDockerVolume(volumeName, execute) {
  const inspect = () => execute(["volume", "inspect", volumeName])
  if (inspect().status === 0) return

  const created = execute(["volume", "create", volumeName])
  if (created.status === 0 || inspect().status === 0) return

  const detail = created.stderr?.trim()
  throw new Error(
    detail
      ? `Could not create Docker volume ${volumeName}: ${detail}`
      : `Could not create Docker volume ${volumeName}.`
  )
}
