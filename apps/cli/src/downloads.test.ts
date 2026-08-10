import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Effect } from "effect"
import { describe, expect, it } from "vite-plus/test"

import { downloadBackupEffect } from "./downloads.js"

describe("backup downloads", () => {
  it("streams the response into the requested local file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kiln-cli-download-"))
    const localPath = join(directory, "backup.zip")
    try {
      const result = await Effect.runPromise(
        downloadBackupEffect({
          localPath,
          url: "data:application/octet-stream,backup-content",
        })
      )

      expect(result).toEqual({ bytes: 14, localPath })
      expect(await readFile(localPath, "utf8")).toBe("backup-content")
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
