import { join } from "node:path"

const root = join(import.meta.dir, "..")
const outfile = join(root, "dist", "kiln")
const result = await Bun.build({
  entrypoints: [join(root, "src", "main.ts")],
  external: ["cpu-features"],
  minify: true,
  sourcemap: "linked",
  target: "bun",
  compile: { outfile },
})

if (!result.success) {
  for (const message of result.logs) console.error(message)
  process.exit(1)
}

if (process.platform === "darwin") {
  const signing = Bun.spawnSync([
    "codesign",
    "--entitlements",
    join(root, "entitlements.plist"),
    "--deep",
    "--sign",
    "-",
    outfile,
    "--force",
  ])
  if (!signing.success) {
    process.stderr.write(signing.stderr)
    process.exit(signing.exitCode)
  }
}
