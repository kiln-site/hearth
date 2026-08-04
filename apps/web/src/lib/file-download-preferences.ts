export type FileArchiveFormat = "gzip" | "zip"

export interface FileDownloadPreferences {
  archiveFormat: FileArchiveFormat
  compressByDefault: boolean
  confirmBeforeDownload: boolean
}

export const defaultFileDownloadPreferences: FileDownloadPreferences = {
  archiveFormat: "zip",
  compressByDefault: true,
  confirmBeforeDownload: true,
}

const storageKey = "kiln:file-download-preferences:v1"

export function readFileDownloadPreferences(): FileDownloadPreferences {
  if (typeof window === "undefined") return defaultFileDownloadPreferences
  try {
    const stored = window.localStorage.getItem(storageKey)
    return normalizeFileDownloadPreferences(
      stored === null ? null : JSON.parse(stored)
    )
  } catch {
    return defaultFileDownloadPreferences
  }
}

export function writeFileDownloadPreferences(
  update: Partial<FileDownloadPreferences>
): FileDownloadPreferences {
  const preferences = normalizeFileDownloadPreferences({
    ...readFileDownloadPreferences(),
    ...update,
  })
  if (typeof window === "undefined") return preferences
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(preferences))
  } catch {
    // A blocked or full storage area should not prevent a file download.
  }
  return preferences
}

export function normalizeFileDownloadPreferences(
  value: unknown
): FileDownloadPreferences {
  if (!value || typeof value !== "object") {
    return defaultFileDownloadPreferences
  }
  return {
    archiveFormat:
      "archiveFormat" in value && value.archiveFormat === "gzip"
        ? "gzip"
        : "zip",
    compressByDefault:
      "compressByDefault" in value &&
      typeof value.compressByDefault === "boolean"
        ? value.compressByDefault
        : defaultFileDownloadPreferences.compressByDefault,
    confirmBeforeDownload:
      "confirmBeforeDownload" in value &&
      typeof value.confirmBeforeDownload === "boolean"
        ? value.confirmBeforeDownload
        : defaultFileDownloadPreferences.confirmBeforeDownload,
  }
}

export function fileDownloadName(
  name: string,
  compressed: boolean,
  archiveFormat: FileArchiveFormat
): string {
  if (!compressed) return name
  const base = removeFileDownloadArchiveExtension(name)
  return `${base}.${archiveFormat === "zip" ? "zip" : "gz"}`
}

export function removeFileDownloadArchiveExtension(name: string): string {
  const lowerName = name.toLowerCase()
  if (lowerName.endsWith(".zip")) return name.slice(0, -4)
  if (lowerName.endsWith(".gz")) return name.slice(0, -3)
  return name
}
