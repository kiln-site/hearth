import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { defineConfig } from "vite-plus"

const repositoryRoot = resolve(import.meta.dirname, "../..")
const buildCommit = resolveBuildCommit()
const release = JSON.parse(
  readFileSync(resolve(repositoryRoot, "release.json"), "utf8")
) as { releaseLine: string }
const buildVersion = process.env.KILN_VERSION?.trim() || release.releaseLine

export default defineConfig({
  pack: {
    define: {
      "import.meta.env.KILN_BUILD_SHA": JSON.stringify(buildCommit),
      "import.meta.env.KILN_VERSION": JSON.stringify(buildVersion),
    },
    deps: {
      // Relay ships its locked production dependency tree. Keeping packages
      // external avoids rebundling CommonJS, native, and instrumented modules.
      skipNodeModulesBundle: true,
    },
    entry: ["src/index.ts", "src/updater.ts", "instrument.mjs"],
    format: "esm",
    minify: true,
    outDir: "dist",
    platform: "node",
    sourcemap: true,
    target: "node24",
  },
  run: {
    tasks: {
      build: {
        command: "vp pack",
        dependsOn: [{ task: "build", from: "dependencies" }],
        env: [
          "COMMIT_SHA",
          "GITHUB_SHA",
          "KILN_BUILD_SHA",
          "KILN_VERSION",
          "SOURCE_COMMIT",
        ],
      },
      test: {
        command: "vp test run",
        dependsOn: [{ task: "build", from: "dependencies" }],
      },
      typecheck: {
        command: "tsc --noEmit",
        dependsOn: [{ task: "build", from: "dependencies" }],
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
})

function resolveBuildCommit(): string {
  const configured = [
    process.env.KILN_BUILD_SHA,
    process.env.GITHUB_SHA,
    process.env.COMMIT_SHA,
    process.env.SOURCE_COMMIT,
  ]
    .find((value) => value?.trim())
    ?.trim()

  if (configured) return configured

  try {
    const head = readFileSync(
      resolve(repositoryRoot, ".git/HEAD"),
      "utf8"
    ).trim()
    if (!head.startsWith("ref: ")) return head

    const reference = head.slice(5)
    try {
      return readFileSync(
        resolve(repositoryRoot, `.git/${reference}`),
        "utf8"
      ).trim()
    } catch {
      const packedReferences = readFileSync(
        resolve(repositoryRoot, ".git/packed-refs"),
        "utf8"
      )
      return (
        packedReferences
          .split("\n")
          .find((line) => line.endsWith(` ${reference}`))
          ?.split(" ")[0] ?? ""
      )
    }
  } catch {
    return ""
  }
}
