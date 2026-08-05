export const INSTALLATION_MARKER_ENV = "KILN_INSTALLATION_MARKER"
export const INSTALLATION_MARKER_LABEL = "kiln.brick.installation-marker"

export function installationMarkerName(
  value: string | undefined
): string | null {
  if (
    !value ||
    value === "." ||
    value === ".." ||
    !/^[.a-zA-Z0-9_-]{1,64}$/u.test(value)
  ) {
    return null
  }
  return value
}
