import { copyFile, readdir, readFile } from "node:fs/promises"
import { basename } from "node:path"

const clientAssets = new URL("../dist/client/assets/", import.meta.url)
const serverOutput = new URL("../dist/server/", import.meta.url)
const clientFiles = await readdir(clientAssets)
const stylesheet = clientFiles.find((file) => /^globals-.+\.css$/u.test(file))

if (!stylesheet) throw new Error("The production stylesheet was not emitted")

const referencedStylesheets = new Set()
for (const file of await javascriptFiles(serverOutput)) {
  const source = await readFile(file, "utf8")
  for (const match of source.matchAll(/globals-[A-Za-z0-9_-]+\.css/gu)) {
    referencedStylesheets.add(match[0])
  }
}

for (const referenced of referencedStylesheets) {
  if (clientFiles.includes(referenced)) continue
  await copyFile(new URL(stylesheet, clientAssets), new URL(referenced, clientAssets))
  console.info(`Copied ${stylesheet} to the SSR asset name ${referenced}`)
}

async function javascriptFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory)
    if (entry.isDirectory()) files.push(...(await javascriptFiles(path)))
    else if (basename(path.pathname).endsWith(".js")) files.push(path)
  }
  return files
}
