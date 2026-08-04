import { describe, expect, it } from "vite-plus/test"

import {
  defaultFileDownloadPreferences,
  fileDownloadName,
  normalizeFileDownloadPreferences,
  removeFileDownloadArchiveExtension,
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

  it("updates archive extensions without stacking them", () => {
    expect(fileDownloadName("latest.log", true, "zip")).toBe("latest.log.zip")
    expect(fileDownloadName("latest.log.zip", true, "gzip")).toBe(
      "latest.log.gz"
    )
    expect(fileDownloadName("latest.log", false, "zip")).toBe("latest.log")
    expect(removeFileDownloadArchiveExtension("latest.log.gz")).toBe(
      "latest.log"
    )
  })
})
