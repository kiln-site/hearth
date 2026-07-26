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
