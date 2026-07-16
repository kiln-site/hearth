import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { defineConfig } from "vite"
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const repositoryRoot = resolve(import.meta.dirname, "../..")

const config = defineConfig(({ command }) => {
  const buildCommit = command === "serve" ? "" : resolveBuildCommit()

  return {
    define: {
      "import.meta.env.VITE_KILN_BUILD_SHA": JSON.stringify(buildCommit),
    },
    envDir: "../..",
    resolve: { tsconfigPaths: true },
    // Browser errors remain available in devtools and the collaborative preview.
    // Forwarding them back through Vite can recursively re-forward its own output.
    server: {
      allowedHosts: ["localhost", "hearth.hearth.orb.local"],
      forwardConsole: false,
      host: "0.0.0.0",
    },
    plugins: [
      devtools(),
      tailwindcss(),
      tanstackStart(),
      sentryTanstackStart({
        org: "quartzdev",
        project: "javascript-tanstackstart-react",
        authToken: process.env.SENTRY_AUTH_TOKEN,
        sourcemaps: {
          disable: process.env.SENTRY_AUTH_TOKEN ? false : "disable-upload",
        },
        tunnelRoute: "/monitoring",
      }),
      viteReact(),
    ],
  }
})

export default config

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
