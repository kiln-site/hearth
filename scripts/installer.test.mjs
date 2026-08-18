import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

const root = resolve(import.meta.dirname, "..")
const installer = join(root, "apps/web/public/install.sh")

function runInstaller(directory, mode, environment = {}) {
  return spawnSync("bash", [installer, mode], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      KILN_DOMAIN: "example.com",
      KILN_INSTALL_DIR: directory,
      KILN_INSTALL_DRY_RUN: "true",
      ...environment,
    },
  })
}

function dotenv(directory) {
  return Object.fromEntries(
    readFileSync(join(directory, ".env"), "utf8")
      .trim()
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=")
        return [line.slice(0, separator), line.slice(separator + 1)]
      })
  )
}

test("generates a production Kiln installation", () => {
  const directory = mkdtempSync(join(tmpdir(), "kiln-installer-"))
  const result = runInstaller(directory, "kiln")
  assert.equal(result.status, 0, result.stderr)

  const environment = dotenv(directory)
  assert.equal(environment.KILN_INSTALL_MODE, "kiln")
  assert.equal(environment.KILN_HEARTH_PUBLIC_URL, "https://hearth.example.com")
  assert.equal(environment.KILN_RELAY_PUBLIC_URL, "https://relay.example.com")
  assert.equal(environment.KILN_RELAY_ALLOW_PROVISIONING, "true")
  assert.equal(environment.KILN_RELAY_PUBLISH_ADDRESS, "127.0.0.1")
  assert.equal(environment.KILN_RELAY_SFTP_PUBLISH_ADDRESS, "0.0.0.0")
  assert.match(environment.KILN_INSTALLATION_ID, /^kiln-[a-f0-9]{24}$/u)
  assert.match(environment.BETTER_AUTH_SECRETS, /^1:[a-f0-9]{64}$/u)
  assert.match(environment.DB_PASSWORD, /^[a-f0-9]{64}$/u)
  assert.match(
    readFileSync(join(directory, "compose.yaml"), "utf8"),
    /ghcr\.io\/kiln-site\/hearth:latest/u
  )
  assert.equal(
    readFileSync(join(directory, "compose.yaml"), "utf8"),
    readFileSync(join(root, "deploy/compose.yaml"), "utf8")
  )
  assert.equal(
    readFileSync(join(directory, "compose.proxy.yaml"), "utf8"),
    readFileSync(join(root, "deploy/compose.traefik.yaml"), "utf8")
  )
})

test("reruns preserve secrets and unknown configuration while changing mode", () => {
  const directory = mkdtempSync(join(tmpdir(), "kiln-installer-rerun-"))
  const first = runInstaller(directory, "kiln")
  assert.equal(first.status, 0, first.stderr)
  const before = dotenv(directory)
  appendFileSync(join(directory, ".env"), "CUSTOM_SETTING=preserved\n")

  const second = runInstaller(directory, "hearth")
  assert.equal(second.status, 0, second.stderr)
  const after = dotenv(directory)

  for (const key of [
    "BETTER_AUTH_SECRETS",
    "DB_PASSWORD",
    "KILN_INSTALLATION_ID",
    "KILN_PLATFORM_BACKUP_KEY",
    "KILN_RELAY_BOOTSTRAP_TOKEN",
    "MYSQL_ROOT_PASSWORD",
  ]) {
    assert.equal(after[key], before[key], key)
  }
  assert.equal(after.CUSTOM_SETTING, "preserved")
  assert.equal(after.KILN_INSTALL_MODE, "hearth")
  assert.equal(after.KILN_RELAY_ALLOW_PROVISIONING, "false")
  assert.equal(after.KILN_RELAY_SFTP_PUBLISH_ADDRESS, "127.0.0.1")
  assert.equal(after.KILN_HEARTH_HOST, "hearth.example.com")
  assert.equal(after.KILN_RELAY_HOST, "relay.example.com")
})

test("leaving Hearth mode restores the public SFTP default", () => {
  const directory = mkdtempSync(join(tmpdir(), "kiln-installer-mode-cycle-"))
  assert.equal(runInstaller(directory, "hearth").status, 0)
  const result = runInstaller(directory, "kiln")
  assert.equal(result.status, 0, result.stderr)
  assert.equal(dotenv(directory).KILN_RELAY_SFTP_PUBLISH_ADDRESS, "0.0.0.0")
})

test("implicit proxy selection preserves an existing installation choice", () => {
  const directory = mkdtempSync(join(tmpdir(), "kiln-installer-proxy-"))
  assert.equal(
    runInstaller(directory, "kiln", { KILN_PROXY: "coolify" }).status,
    0
  )
  assert.equal(
    readFileSync(join(directory, "compose.proxy.yaml"), "utf8"),
    readFileSync(join(root, "deploy/compose.coolify.yaml"), "utf8")
  )
  const result = runInstaller(directory, "kiln")
  assert.equal(result.status, 0, result.stderr)
  assert.equal(dotenv(directory).KILN_RELAY_PROXY, "coolify")

  const redetected = runInstaller(directory, "kiln", { KILN_PROXY: "auto" })
  assert.equal(redetected.status, 0, redetected.stderr)
  assert.equal(dotenv(directory).KILN_RELAY_PROXY, "traefik")
})

test("rejects unsafe runtime values", () => {
  const directory = mkdtempSync(join(tmpdir(), "kiln-installer-values-"))
  for (const [key, value] of [
    ["KILN_RELAY_PORT", "70000"],
    ["KILN_RELAY_GAME_PORT_RANGE", "39999-30000"],
    ["KILN_RELAY_PUBLISH_ADDRESS", "0.0.0.0"],
    ["KILN_RELAY_PUBLISH_ADDRESS", "192.0.2.1"],
    ["KILN_ACME_EMAIL", "not-an-email"],
  ]) {
    const result = runInstaller(directory, "kiln", { [key]: value })
    assert.notEqual(result.status, 0, `${key} was accepted`)
  }
})

test("rejects hostname changes on an existing paired topology", () => {
  const directory = mkdtempSync(join(tmpdir(), "kiln-installer-host-change-"))
  assert.equal(runInstaller(directory, "kiln").status, 0)
  const result = runInstaller(directory, "kiln", {
    KILN_DOMAIN: "new.example.com",
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Changing an installed Hearth hostname/u)
})

test("relay placeholder does not block a later full install", () => {
  const directory = mkdtempSync(join(tmpdir(), "kiln-installer-relay-upgrade-"))
  assert.equal(
    runInstaller(directory, "relay", {
      KILN_DOMAIN: "",
      KILN_RELAY_HOST: "relay.example.com",
    }).status,
    0
  )
  const missingHost = runInstaller(directory, "kiln", {
    KILN_DOMAIN: "",
    KILN_RELAY_HOST: "relay.example.com",
  })
  assert.notEqual(missingHost.status, 0)
  assert.match(missingHost.stderr, /KILN_HEARTH_HOST/u)

  const upgraded = runInstaller(directory, "kiln")
  assert.equal(upgraded.status, 0, upgraded.stderr)
  assert.equal(dotenv(directory).KILN_HEARTH_HOST, "hearth.example.com")
})

test("relay mode accepts a Relay hostname without a Hearth hostname", () => {
  const directory = mkdtempSync(join(tmpdir(), "kiln-installer-relay-"))
  const result = runInstaller(directory, "relay", {
    KILN_DOMAIN: "",
    KILN_RELAY_HOST: "node.example.com",
  })
  assert.equal(result.status, 0, result.stderr)
  const environment = dotenv(directory)
  assert.equal(environment.KILN_INSTALL_MODE, "relay")
  assert.equal(environment.KILN_RELAY_HOST, "node.example.com")
  assert.equal(environment.KILN_HEARTH_HOST, "hearth.invalid")
  assert.equal(environment.KILN_HEARTH_PUBLIC_URL, "")
  assert.equal(environment.KILN_HEARTH_INTERNAL_URL, "")
})

test("rejects unsupported modes", () => {
  const directory = mkdtempSync(join(tmpdir(), "kiln-installer-invalid-"))
  const mode = runInstaller(directory, "everything")
  assert.notEqual(mode.status, 0)
  assert.match(mode.stderr, /Unknown install mode/u)
})

test("installer script parses and contains no destructive volume operations", () => {
  const syntax = spawnSync("bash", ["-n", installer], {
    cwd: root,
    encoding: "utf8",
  })
  assert.equal(syntax.status, 0, syntax.stderr)
  const source = readFileSync(installer, "utf8")
  assert.doesNotMatch(source, /down\s+(?:[^\n]*\s)?-v(?:\s|$)/u)
  assert.doesNotMatch(source, /docker\s+volume\s+(?:rm|prune)/u)
  assert.doesNotMatch(source, /docker\s+system\s+prune/u)
  assert.doesNotMatch(source, /unhealthy\s*\|\s*exited/u)
  assert.match(source, /docker pull "\$TRAEFIK_IMAGE"/u)
  assert.match(source, /docker network disconnect -f kiln-relay-edge/u)
  assert.match(source, /docker ps --filter "publish=\$\{port\}"/u)
})
