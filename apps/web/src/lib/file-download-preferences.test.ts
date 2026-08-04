import { describe, expect, it } from "vite-plus/test"

import {
  defaultFileDownloadPreferences,
  defaultFileDownloadPreferencesSnapshot,
  fileDownloadArchiveSuffix,
  fileDownloadName,
  fileDownloadPreferencesFromSnapshot,
  normalizeFileDownloadPreferences,
} from "./file-download-preferences"

describe("file download preferences", () => {
  it("uses a Windows-friendly compressed download by default", () => {
    expect(normalizeFileDownloadPreferences(null)).toEqual(
      defaultFileDownloadPreferences
    )
    expect(defaultFileDownloadPreferences).toEqual({
      archiveFormat: "zip",
      compressByDefault: true,
      confirmBeforeDownload: true,
    })
  })

  it("accepts only supported preference values", () => {
    expect(
      normalizeFileDownloadPreferences({
        archiveFormat: "gzip",
        compressByDefault: false,
        confirmBeforeDownload: false,
      })
    ).toEqual({
      archiveFormat: "gzip",
      compressByDefault: false,
      confirmBeforeDownload: false,
    })
    expect(
      normalizeFileDownloadPreferences({
        archiveFormat: "tar",
        compressByDefault: "yes",
      })
    ).toEqual(defaultFileDownloadPreferences)
  })

  it("provides a stable server snapshot for settings hydration", () => {
    const snapshot = defaultFileDownloadPreferencesSnapshot()
    expect(fileDownloadPreferencesFromSnapshot(snapshot)).toEqual(
      defaultFileDownloadPreferences
    )
    expect(fileDownloadPreferencesFromSnapshot("not json")).toEqual(
      defaultFileDownloadPreferences
    )
  })

  it("keeps the source basename intact when compression changes", () => {
    expect(fileDownloadName("latest.log", true, "zip")).toBe("latest.log.zip")
    expect(fileDownloadName("latest.log.zip", true, "gzip")).toBe(
      "latest.log.zip.gz"
    )
    expect(fileDownloadName("world.zip", false, "zip")).toBe("world.zip")
    expect(fileDownloadName("latest.log.gz", false, "gzip")).toBe(
      "latest.log.gz"
    )
    expect(fileDownloadArchiveSuffix("zip")).toBe(".zip")
    expect(fileDownloadArchiveSuffix("gzip")).toBe(".gz")
  })
})
