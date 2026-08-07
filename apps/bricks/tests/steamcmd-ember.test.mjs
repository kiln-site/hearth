import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const entrypoint = join(root, "embers/steamcmd/entrypoint.sh")

function runSteamEmber(serverDirectory) {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn("bash", [entrypoint], {
      cwd: serverDirectory,
      env: {
        ...process.env,
        KILN_INSTALLATION_MARKER: ".kiln-ember-installed",
        KILN_STEAM_APP_ID: "2394010",
        KILN_STEAM_EXECUTABLE: "PalServer.sh",
        KILN_STEAM_INSTALL_DIR: serverDirectory,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk
    })
    child.once("error", rejectResult)
    child.once("close", (status) => resolveResult({ status, stderr, stdout }))
  })
}

test("the SteamCMD Ember writes the installation marker before starting the server", async (context) => {
  const serverDirectory = await mkdtemp(join(tmpdir(), "kiln-steam-ember-"))
  context.after(() => rm(serverDirectory, { force: true, recursive: true }))

  const steamcmdDirectory = join(serverDirectory, ".steamcmd")
  await mkdir(steamcmdDirectory, { recursive: true })
  const steamcmdPath = join(steamcmdDirectory, "steamcmd.sh")
  await writeFile(steamcmdPath, "#!/usr/bin/env bash\nexit 0\n")
  await chmod(steamcmdPath, 0o755)

  const executablePath = join(serverDirectory, "PalServer.sh")
  await writeFile(
    executablePath,
    "#!/usr/bin/env bash\ntest -f .kiln-ember-installed\necho 'fake Steam server started'\n",
  )
  await chmod(executablePath, 0o755)

  const result = await runSteamEmber(serverDirectory)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /fake Steam server started/u)
  assert.equal(
    await readFile(join(serverDirectory, ".kiln-ember-installed"), "utf8"),
    "",
  )
})

test("the SteamCMD Ember leaves the marker absent after an installation failure", async (context) => {
  const serverDirectory = await mkdtemp(join(tmpdir(), "kiln-steam-ember-"))
  context.after(() => rm(serverDirectory, { force: true, recursive: true }))

  const markerPath = join(serverDirectory, ".kiln-ember-installed")
  await writeFile(markerPath, "stale")
  const steamcmdDirectory = join(serverDirectory, ".steamcmd")
  await mkdir(steamcmdDirectory, { recursive: true })
  const steamcmdPath = join(steamcmdDirectory, "steamcmd.sh")
  await writeFile(steamcmdPath, "#!/usr/bin/env bash\nexit 42\n")
  await chmod(steamcmdPath, 0o755)

  const result = await runSteamEmber(serverDirectory)

  assert.equal(result.status, 42)
  await assert.rejects(readFile(markerPath), { code: "ENOENT" })
})
