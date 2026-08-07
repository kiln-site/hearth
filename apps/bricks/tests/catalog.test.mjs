import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { test } from "node:test"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import Ajv2020 from "ajv/dist/2020.js"
import addFormats from "ajv-formats"
import { parse } from "yaml"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const loadJson = async (path) => JSON.parse(await readFile(join(root, path), "utf8"))
const loadYaml = async (path) => parse(await readFile(join(root, path), "utf8"), {
  maxAliasCount: 20,
  prettyErrors: true,
  uniqueKeys: true,
})

const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
const validateCatalog = ajv.compile(await loadJson("schema/catalog-v1.schema.json"))
const validateRecipe = ajv.compile(await loadJson("schema/recipe-v1.schema.json"))

test("the official catalog and every recipe satisfy the v1 schemas", async () => {
  const catalog = await loadYaml("catalog.yml")
  assert.equal(validateCatalog(catalog), true, ajv.errorsText(validateCatalog.errors))

  const recipeFiles = (await readdir(join(root, "recipes")))
    .filter((name) => name.endsWith(".yml"))
    .map((name) => `recipes/${name}`)
    .sort((left, right) => left.localeCompare(right))
  assert.deepEqual(
    [...catalog.recipes].sort((left, right) => left.localeCompare(right)),
    recipeFiles,
  )

  const ids = new Set()
  for (const recipePath of catalog.recipes) {
    const recipe = await loadYaml(recipePath)
    assert.equal(validateRecipe(recipe), true, `${recipePath}: ${ajv.errorsText(validateRecipe.errors)}`)
    assert.equal(ids.has(recipe.metadata.id), false, `duplicate metadata.id ${recipe.metadata.id}`)
    ids.add(recipe.metadata.id)
    for (const [name, variable] of Object.entries(recipe.variables)) {
      if ("default" in variable) {
        assert.equal(
          typeof variable.default,
          variable.type,
          `${recipePath}: ${name}.default must match its declared type`,
        )
      }
      for (const option of variable.options ?? []) {
        assert.equal(
          typeof option,
          variable.type,
          `${recipePath}: ${name}.options must match its declared type`,
        )
      }
    }
    assert.equal(
      recipe.network.ports.some(({ name }) => name === recipe.network.primaryPort),
      true,
      `${recipePath}: primaryPort must name a declared port`,
    )
    assert.equal(
      new Set(recipe.console?.stopCommands ?? []).size,
      recipe.console?.stopCommands.length ?? 0,
      `${recipePath}: console stop commands must be unique`,
    )
    const installationMarker = recipe.runtime.environment.KILN_INSTALLATION_MARKER
    if (installationMarker) {
      assert.match(installationMarker, /^\.kiln-[a-zA-Z0-9._-]{1,58}$/u)
    }
  }
})

test("installer-aware Ember images advertise the marker protocol", async () => {
  for (const path of ["embers/java/Dockerfile", "embers/steamcmd/Dockerfile"]) {
    assert.match(
      await readFile(join(root, path), "utf8"),
      /^LABEL kiln\.ember\.installation-marker="v1"$/mu,
      path,
    )
  }
})

test("entrypoints pass Bash syntax validation in CI", async () => {
  const entrypoints = [
    "embers/java/entrypoint.sh",
    "embers/steamcmd/entrypoint.sh",
  ]
  for (const path of entrypoints) {
    assert.match(await readFile(join(root, path), "utf8"), /^#!\/usr\/bin\/env bash/u)
  }
})
