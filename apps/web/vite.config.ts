import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { defineConfig, lazyPlugins } from "vite-plus"
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const repositoryRoot = resolve(import.meta.dirname, "../..")
const reactScanProductionShim = resolve(
  import.meta.dirname,
  "node_modules/react-scan/dist/rsc-shim.mjs"
)

const config = defineConfig(({ command }) => {
  const buildCommit = command === "serve" ? "" : resolveBuildCommit()
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN

  return {
    run: {
      tasks: {
        build: {
          command: [
            "vp build",
            "node scripts/normalize-build-assets.mjs",
            "vp pack",
          ],
          dependsOn: [{ task: "build", from: "dependencies" }],
          env: [
            "COMMIT_SHA",
            "GITHUB_SHA",
            "KILN_BUILD_SHA",
            "SENTRY_AUTH_TOKEN",
            "SOURCE_COMMIT",
          ],
        },
        test: {
          command: ["vp test run", "node --test keyring.test.mjs"],
          dependsOn: [{ task: "build", from: "dependencies" }],
        },
        typecheck: {
          command: "tsc --noEmit",
          dependsOn: [{ task: "build", from: "dependencies" }],
        },
      },
    },
    pack: {
      clean: false,
      deps: {
        alwaysBundle: [
          "@opentelemetry/api",
          "@opentelemetry/core",
          "@sentry/tanstackstart-react",
        ],
        onlyBundle: false,
      },
      entry: ["instrument.server.mjs"],
      format: "esm",
      minify: true,
      outDir: "dist/instrument",
      platform: "node",
      target: "node24",
    },
    define: {
      "import.meta.env.VITE_KILN_BUILD_SHA": JSON.stringify(buildCommit),
    },
    envDir: "../..",
    resolve: {
      // Keep React Scan's instrumentation and toolbar out of production bundles.
      alias:
        command === "serve"
          ? []
          : [{ find: /^react-scan$/, replacement: reactScanProductionShim }],
      tsconfigPaths: true,
    },
    ssr: {
      external: ["better-sqlite3", "pg", "tedious"],
      ...(command === "serve" ? {} : { noExternal: true }),
    },
    // Browser errors remain available in devtools and the collaborative preview.
    // Forwarding them back through Vite can recursively re-forward its own output.
    server: {
      allowedHosts: ["localhost", "hearth.hearth.orb.local"],
      forwardConsole: false,
      host: "0.0.0.0",
    },
    plugins: lazyPlugins(() => [
      devtools(),
      tailwindcss(),
      tanstackStart(),
      ...(sentryAuthToken
        ? [
            sentryTanstackStart({
              org: "quartzdev",
              project: "javascript-tanstackstart-react",
              authToken: sentryAuthToken,
              telemetry: false,
            }),
          ]
        : []),
      viteReact(),
    ]),
    test: {
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    },
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
