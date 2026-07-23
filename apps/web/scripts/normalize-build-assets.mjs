import { readdir, readFile, writeFile } from "node:fs/promises"
import { basename } from "node:path"

const clientAssets = new URL("../dist/client/assets/", import.meta.url)
const serverOutput = new URL("../dist/server/", import.meta.url)
const clientFiles = await readdir(clientAssets)
const stylesheet = clientFiles.find((file) => /^globals-.+\.css$/u.test(file))

if (!stylesheet) throw new Error("The production stylesheet was not emitted")

let rewrittenFiles = 0
for (const file of await javascriptFiles(serverOutput)) {
  const source = await readFile(file, "utf8")
  const normalized = source.replace(/globals-[A-Za-z0-9_-]+\.css/gu, stylesheet)
  if (normalized !== source) {
    await writeFile(file, normalized)
    rewrittenFiles += 1
  }
}

console.info(
  `Normalized ${rewrittenFiles} SSR asset reference${rewrittenFiles === 1 ? "" : "s"} to ${stylesheet}`
)

async function javascriptFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(
      `${entry.name}${entry.isDirectory() ? "/" : ""}`,
      directory
    )
    if (entry.isDirectory()) files.push(...(await javascriptFiles(path)))
    else if (basename(path.pathname).endsWith(".js")) files.push(path)
  }
  return files
}
