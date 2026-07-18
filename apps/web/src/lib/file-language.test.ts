import { describe, expect, it } from "vitest"

import { fileLanguageForPath } from "./file-language"

describe("fileLanguageForPath", () => {
  it.each([
    ["server.properties", { id: "properties", label: "Properties" }],
    ["PalWorldSettings.ini", { id: "ini", label: "INI" }],
    ["config/velocity.toml", { id: "toml", label: "TOML" }],
    ["plugins/config.YAML", { id: "yaml", label: "YAML" }],
    ["logs/latest.log.gz", { id: "log", label: "LOG" }],
    ["pack.mcmeta", { id: "json", label: "MCMETA" }],
    ["config/server.cfg", { id: "properties", label: "CFG" }],
    ["scripts/start.sh", { id: "shell", label: "Shell" }],
    ["steamapps/libraryfolders.vdf", { id: "valve-keyvalues", label: "VDF" }],
    [
      "steamapps/appmanifest_2394010.acf",
      { id: "valve-keyvalues", label: "ACF" },
    ],
    ["Manifest_UFSFiles_Linux.txt", { id: "text", label: "Text" }],
    ["data/telemetry.tps", { id: "text", label: "TPS" }],
    ["data/archive.adf", { id: "text", label: "ADF" }],
    ["LICENSE", { id: "text", label: "Plain Text" }],
  ])("detects %s", (path, expected) => {
    expect(fileLanguageForPath(path)).toEqual(expected)
  })
})
