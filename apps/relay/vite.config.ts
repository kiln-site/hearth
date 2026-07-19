import { defineConfig } from "vite-plus"

export default defineConfig({
  pack: {
    deps: {
      alwaysBundle: [
        "@opentelemetry/api",
        "@opentelemetry/core",
        "@sentry/node",
        "@workspace/contracts",
        "effect",
        "yaml",
      ],
      onlyBundle: false,
    },
    entry: ["src/index.ts", "instrument.mjs"],
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
