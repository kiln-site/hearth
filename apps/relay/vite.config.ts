import { defineConfig } from "vite-plus"

export default defineConfig({
  pack: {
    deps: {
      alwaysBundle: [
        "@effect/sql-sqlite-node",
        "@node-rs/argon2",
        "@opentelemetry/api",
        "@opentelemetry/core",
        "@peculiar/x509",
        "@sentry/node",
        "@workspace/contracts",
        "acme-client",
        "effect",
        "qrcode",
        "reflect-metadata",
        "ssh2",
        "ws",
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
