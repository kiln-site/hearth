import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir } from "node:fs/promises"

import { chromium } from "playwright-core"

try {
  process.loadEnvFile()
} catch {
  // CI may provide the Relay key directly rather than through a local .env.
}

const baseUrl = process.env.KILN_E2E_URL || "http://localhost:3000"
const relayUrl = process.env.KILN_E2E_RELAY_URL || "http://127.0.0.1:4100"
const relayKey = process.env.KILN_RELAY_KEY
const chrome =
  process.env.KILN_E2E_CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const paperRecipe =
  "https://raw.githubusercontent.com/kiln-site/bricks/main/recipes/paper.yml"
const displayName = `Recipe E2E ${Date.now().toString(36)}`

assert.ok(relayKey, "KILN_RELAY_KEY is required for E2E cleanup")
await mkdir("artifacts", { recursive: true })

let instanceId = null
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
page.setDefaultTimeout(60_000)
const browserErrors = []
const responseErrors = []
page.on("console", (message) => {
  if (message.type() === "error") browserErrors.push(message.text())
})
page.on("pageerror", (error) => browserErrors.push(error.message))
page.on("response", (response) => {
  if (response.status() >= 400) {
    responseErrors.push(`${response.status()} ${response.url()}`)
  }
})

try {
  await page.goto(`${baseUrl}/bricks`, { waitUntil: "domcontentloaded" })
  const developmentBypass = page.getByRole("button", {
    name: "Skip login for development",
  })
  const bypassVisible = await developmentBypass
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false)
  assert.equal(bypassVisible, true, "Development login bypass is not available")
  if (bypassVisible) {
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].some(
          (button) =>
            button.textContent?.includes("Skip login for development") &&
            Object.keys(button).some((key) => key.startsWith("__reactProps"))
        ),
      null,
      { timeout: 30_000 }
    )
    await developmentBypass.click()
  }
  await page.waitForTimeout(2_000)
  if (!/\/bricks$/u.test(new URL(page.url()).pathname)) {
    const visibleError = await page
      .locator("[class*='destructive']")
      .allTextContents()
    throw new Error(
      `Development bypass stayed at ${page.url()}: ${visibleError.join(" ") || "no visible error"}; browser=${browserErrors.join(" | ")}; responses=${responseErrors.join(" | ")}`
    )
  }
  await page.getByRole("heading", { name: "Fire a new Brick." }).waitFor()

  await page.getByRole("button", { name: /Folia/u }).click()
  await page
    .getByLabel("Custom HTTPS recipe")
    .fill("https://127.0.0.1/private-recipe.yml")
  await page.getByRole("button", { name: "Load recipe" }).click()
  await page.getByText(/private or reserved network address/u).waitFor()
  await page.getByLabel("Custom HTTPS recipe").fill(paperRecipe)
  await page.getByRole("button", { name: "Load recipe" }).click()
  await page.getByRole("heading", { name: "Deploy Paper" }).waitFor()

  await page.screenshot({
    path: "artifacts/brick-recipe-form.png",
    fullPage: true,
  })

  await page.getByLabel("Display name").fill(displayName)
  const startAfterProvisioning = page.getByLabel("Start after provisioning")
  if (await startAfterProvisioning.isChecked()) {
    await startAfterProvisioning.uncheck()
  }
  await page.getByRole("button", { name: "Deploy Brick" }).click()
  await page.waitForURL(/\/[a-f0-9]{8}\/console$/u, { timeout: 90_000 })

  const shortId = new URL(page.url()).pathname.split("/")[1]
  assert.match(shortId, /^[a-f0-9]{8}$/u)
  const snapshot = await relayJson("/v1/snapshot")
  const instance = snapshot.instances.find(
    (candidate) => candidate.shortId === shortId
  )
  assert.ok(instance, `Relay snapshot did not contain ${shortId}`)
  instanceId = instance.id
  assert.equal(instance.brickId, "paper")
  assert.equal(instance.brickFormat, "kiln.brick/v1")
  assert.equal(instance.brickSource, paperRecipe)
  assert.equal(instance.brickNetworkMode, "minecraft-backend")

  const inspected = JSON.parse(
    execFileSync("docker", ["inspect", instance.service], { encoding: "utf8" })
  )[0]
  assert.equal(inspected.Config.Image, "ghcr.io/kiln-site/bricks-java:21")
  assert.equal(inspected.Config.Labels["kiln.brick.format"], "kiln.brick/v1")
  assert.equal(inspected.Config.Labels["kiln.brick.source"], paperRecipe)
  assert.equal(
    inspected.Config.Labels["kiln.brick.network-mode"],
    "minecraft-backend"
  )
  assert.equal(
    inspected.Config.Env.includes("KILN_JAVA_MAX_RAM_PERCENTAGE=75.0"),
    true
  )
  assert.equal(
    inspected.Config.Env.some((value) => value.startsWith("MAX_RAM=")),
    false
  )
  assert.equal(inspected.HostConfig.Memory, 2 * 1024 * 1024 * 1024)
  assert.equal(inspected.HostConfig.MemoryReservation, 2 * 1024 * 1024 * 1024)
  assert.equal(inspected.HostConfig.ReadonlyRootfs, true)
  assert.deepEqual(inspected.HostConfig.CapDrop, ["ALL"])

  await page.screenshot({
    path: "artifacts/brick-recipe-e2e.png",
    fullPage: true,
  })
  assert.deepEqual(browserErrors, [])
  console.log(`Brick recipe E2E passed for ${shortId}`)
} finally {
  await browser.close()
  if (instanceId) {
    const response = await fetch(
      `${relayUrl}/v1/instances/${encodeURIComponent(instanceId)}?deleteData=true`,
      { method: "DELETE", headers: relayHeaders() }
    )
    assert.equal(
      response.status,
      204,
      `E2E cleanup returned ${response.status}`
    )
  }
}

async function relayJson(path) {
  const response = await fetch(`${relayUrl}${path}`, {
    headers: relayHeaders(),
  })
  assert.equal(response.ok, true, `Relay ${path} returned ${response.status}`)
  return response.json()
}

function relayHeaders() {
  return { Authorization: `Bearer ${relayKey}` }
}
