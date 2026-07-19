import { defineConfig } from "vite-plus"

export default defineConfig({
  pack: {
    dts: true,
    entry: ["src/index.ts"],
    format: "esm",
    outDir: "dist",
    platform: "neutral",
    target: "es2022",
  },
  run: {
    tasks: {
      build: "vp pack",
    },
  },
})
