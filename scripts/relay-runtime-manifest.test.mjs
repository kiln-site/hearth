import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const workspaceRoot = new URL("../", import.meta.url)

test("Relay runtime manifest includes every external dependency", async () => {
  const [relayPackage, runtimePackage] = await Promise.all([
    readPackage("apps/relay/package.json"),
    readPackage("apps/relay/package.runtime.json"),
  ])
  const bundledDependencies = new Set(["@workspace/contracts"])
  const expected = Object.keys(relayPackage.dependencies)
    .filter((dependency) => !bundledDependencies.has(dependency))
    .sort()
  const actual = Object.keys(runtimePackage.dependencies).sort()

  assert.deepEqual(
    actual,
    expected,
    "Keep package.runtime.json aligned with Relay's external dependencies"
  )
})

async function readPackage(path) {
  return JSON.parse(await readFile(new URL(path, workspaceRoot), "utf8"))
}
