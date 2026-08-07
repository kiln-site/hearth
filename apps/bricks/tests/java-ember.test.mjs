import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

test("the Java Ember reports a terminal download failure and removes the partial artifact", async (context) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "kiln-java-ember-"))
  context.after(() => rm(temporaryDirectory, { force: true, recursive: true }))

  const binDirectory = join(temporaryDirectory, "bin")
  const serverDirectory = join(temporaryDirectory, "server")
  const argumentsPath = join(temporaryDirectory, "curl-arguments")
  await Promise.all([
    mkdir(binDirectory, { recursive: true }),
    mkdir(serverDirectory, { recursive: true }),
  ])

  const curlPath = join(binDirectory, "curl")
  await writeFile(
    curlPath,
    `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$@" > "$FAKE_CURL_ARGUMENTS"
while (($#)); do
  if [[ "$1" == "--output" ]]; then
    printf 'partial' > "$2"
    break
  fi
  shift
done
echo 'curl: (7) simulated network failure' >&2
exit 7
`,
  )
  await chmod(curlPath, 0o755)

  const source = await readFile(join(root, "embers/java/entrypoint.sh"), "utf8")
  const entrypointPath = join(temporaryDirectory, "entrypoint.sh")
  await writeFile(
    entrypointPath,
    source.replace("cd /server", 'cd "${KILN_TEST_SERVER_DIRECTORY:?}"'),
  )
  await chmod(entrypointPath, 0o755)

  const result = await new Promise((resolveResult, rejectResult) => {
    const child = spawn(entrypointPath, {
      env: {
        ...process.env,
        FAKE_CURL_ARGUMENTS: argumentsPath,
        KILN_ARTIFACT_FILE: "paper.jar",
        KILN_ARTIFACT_URL: "https://example.invalid/paper.jar",
        KILN_IMPLEMENTATION: "paper",
        KILN_INSTALLATION_MARKER: ".kiln-ember-installed",
        KILN_TEST_SERVER_DIRECTORY: serverDirectory,
        KILN_VERSION: "1.21.11",
        PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
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

  assert.equal(result.status, 7)
  assert.match(result.stdout, /\[Kiln Ember\] downloading paper 1\.21\.11/u)
  assert.match(result.stderr, /curl: \(7\) simulated network failure/u)
  assert.match(
    result.stderr,
    /failed to download paper 1\.21\.11 after 3 attempts\. Server startup failed\. Swap to a different Brick in Startup, or contact support if this keeps happening\./u,
  )
  await assert.rejects(readFile(join(serverDirectory, ".paper.jar.download")), {
    code: "ENOENT",
  })
  await assert.rejects(
    readFile(join(serverDirectory, ".kiln-ember-installed")),
    { code: "ENOENT" },
  )

  const curlArguments = (await readFile(argumentsPath, "utf8")).split("\n")
  assert.ok(curlArguments.includes("--no-progress-meter"))
  assert.deepEqual(
    curlArguments.slice(
      curlArguments.indexOf("--retry"),
      curlArguments.indexOf("--retry") + 2,
    ),
    ["--retry", "2"],
  )
})

test("the Java Ember writes the installation marker before starting the server", async (context) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "kiln-java-ember-"))
  context.after(() => rm(temporaryDirectory, { force: true, recursive: true }))

  const binDirectory = join(temporaryDirectory, "bin")
  const serverDirectory = join(temporaryDirectory, "server")
  await Promise.all([
    mkdir(binDirectory, { recursive: true }),
    mkdir(serverDirectory, { recursive: true }),
  ])

  const curlPath = join(binDirectory, "curl")
  await writeFile(
    curlPath,
    `#!/usr/bin/env bash
set -eu
while (($#)); do
  if [[ "$1" == "--output" ]]; then
    printf 'complete artifact' > "$2"
    exit 0
  fi
  shift
done
exit 2
`,
  )
  await chmod(curlPath, 0o755)

  const javaPath = join(binDirectory, "java")
  await writeFile(
    javaPath,
    `#!/usr/bin/env bash
set -eu
if [[ "\${1:-}" == "-version" ]]; then
  echo 'openjdk version "test"' >&2
  exit 0
fi
test -f "$KILN_TEST_SERVER_DIRECTORY/.kiln-ember-installed"
echo 'fake server started'
`,
  )
  await chmod(javaPath, 0o755)

  const source = await readFile(join(root, "embers/java/entrypoint.sh"), "utf8")
  const entrypointPath = join(temporaryDirectory, "entrypoint.sh")
  await writeFile(
    entrypointPath,
    source.replace("cd /server", 'cd "${KILN_TEST_SERVER_DIRECTORY:?}"'),
  )
  await chmod(entrypointPath, 0o755)

  const result = await new Promise((resolveResult, rejectResult) => {
    const child = spawn(entrypointPath, {
      env: {
        ...process.env,
        KILN_ARTIFACT_FILE: "paper.jar",
        KILN_ARTIFACT_URL: "https://example.invalid/paper.jar",
        KILN_IMPLEMENTATION: "paper",
        KILN_INSTALLATION_MARKER: ".kiln-ember-installed",
        KILN_TEST_SERVER_DIRECTORY: serverDirectory,
        KILN_VERSION: "1.21.11",
        PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
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

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /fake server started/u)
  assert.equal(
    await readFile(join(serverDirectory, ".kiln-ember-installed"), "utf8"),
    "",
  )
})

test("the Java Ember rejects marker names outside the reserved namespace", async (context) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "kiln-java-ember-"))
  context.after(() => rm(temporaryDirectory, { force: true, recursive: true }))

  const serverDirectory = join(temporaryDirectory, "server")
  await mkdir(serverDirectory, { recursive: true })
  await writeFile(join(serverDirectory, "paper.jar"), "keep me")

  const source = await readFile(join(root, "embers/java/entrypoint.sh"), "utf8")
  const entrypointPath = join(temporaryDirectory, "entrypoint.sh")
  await writeFile(
    entrypointPath,
    source.replace("cd /server", 'cd "${KILN_TEST_SERVER_DIRECTORY:?}"'),
  )
  await chmod(entrypointPath, 0o755)

  const result = await new Promise((resolveResult, rejectResult) => {
    const child = spawn(entrypointPath, {
      env: {
        ...process.env,
        KILN_ARTIFACT_FILE: "paper.jar",
        KILN_ARTIFACT_URL: "https://example.invalid/paper.jar",
        KILN_INSTALLATION_MARKER: "paper.jar",
        KILN_TEST_SERVER_DIRECTORY: serverDirectory,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stderr = ""
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk
    })
    child.once("error", rejectResult)
    child.once("close", (status) => resolveResult({ status, stderr }))
  })

  assert.equal(result.status, 64)
  assert.match(result.stderr, /must be a reserved \.kiln-\* filename/u)
  assert.equal(await readFile(join(serverDirectory, "paper.jar"), "utf8"), "keep me")
})
