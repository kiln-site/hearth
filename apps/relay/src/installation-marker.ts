export const INSTALLATION_MARKER_ENV = "KILN_INSTALLATION_MARKER"
export const INSTALLATION_MARKER_LABEL = "kiln.brick.installation-marker"
export const INSTALLATION_MARKER_PROTOCOL_LABEL =
  "kiln.ember.installation-marker"

export function supportsInstallationMarkerProtocol(
  value: string | undefined
): boolean {
  return value === "v1"
}

export function installationMarkerName(
  value: string | undefined
): string | null {
  if (!value || !/^\.kiln-[a-zA-Z0-9._-]{1,58}$/u.test(value)) {
    return null
  }
  return value
}
