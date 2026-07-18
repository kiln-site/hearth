import { readFile } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { parseDocument } from "yaml"
import {
  brickCatalogDocumentSchema,
  brickRecipeSchema,
  relayCatalogSchema,
} from "@workspace/contracts"

import { BrickRecipeError } from "./effect/errors.js"
import type {
  Brick,
  BrickCatalogDocument,
  BrickRecipe,
  BrickVariable,
  BrickVariableValue,
  RelayCatalog,
} from "@workspace/contracts"

const MAX_DOCUMENT_BYTES = 1024 * 1024
const CACHE_TTL_MS = 5 * 60_000
interface CachedCatalog {
  expiresAt: number
  value: RelayCatalog
}

export interface ResolvedBrick {
  environment: Readonly<Record<string, string>>
  memory: string
  memoryReservation: string
  recipe: BrickRecipe
  values: Readonly<Record<string, BrickVariableValue>>
}

export class BrickCatalog {
  readonly #catalogUrl: URL
  #cache: CachedCatalog | null = null

  constructor(catalogUrl: string) {
    this.#catalogUrl = parseUrl(catalogUrl, "configured catalog")
    validateCatalogProtocol(this.#catalogUrl)
  }

  async catalog(): Promise<RelayCatalog> {
    if (this.#cache && this.#cache.expiresAt > Date.now()) {
      return this.#cache.value
    }
    const document = parseCatalog(
      await readDocument(this.#catalogUrl, this.#catalogUrl)
    )
    const bricks = await Promise.all(
      document.recipes.map(async (reference) => {
        const source = parseUrl(reference, this.#catalogUrl)
        return {
          ...(await this.#loadRecipe(source, true)),
          source: source.href,
        } satisfies Brick
      })
    )
    const ids = new Set<string>()
    for (const brick of bricks) {
      if (ids.has(brick.metadata.id)) {
        throw recipeError(
          "duplicate_brick_id",
          this.#catalogUrl.href,
          `Catalog contains duplicate Brick id ${brick.metadata.id}`
        )
      }
      ids.add(brick.metadata.id)
    }
    const value = relayCatalogSchema.parse({
      format: "kiln.catalog/v1",
      bricks,
    })
    this.#cache = { expiresAt: Date.now() + CACHE_TTL_MS, value }
    return value
  }

  async recipe(source: string): Promise<BrickRecipe> {
    const url = parseUrl(source, "recipe source")
    const official = (await this.catalog()).bricks.find(
      (brick) => brick.source === url.href
    )
    if (official) {
      const { source: _source, ...recipe } = official
      return recipe
    }
    if (url.protocol !== "https:") {
      throw recipeError(
        "insecure_recipe_source",
        url.href,
        "Custom Brick recipes must use HTTPS"
      )
    }
    return this.#loadRecipe(url, false)
  }

  async #loadRecipe(source: URL, fromCatalog: boolean): Promise<BrickRecipe> {
    if (!fromCatalog && source.protocol !== "https:") {
      throw recipeError(
        "insecure_recipe_source",
        source.href,
        "Custom Brick recipes must use HTTPS"
      )
    }
    const input = parseYaml(
      await readDocument(source, this.#catalogUrl),
      source
    )
    const parsed = brickRecipeSchema.safeParse(input)
    if (!parsed.success) {
      throw recipeError(
        "invalid_recipe",
        source.href,
        parsed.error.issues
          .slice(0, 4)
          .map(
            (issue) => `${issue.path.join(".") || "recipe"}: ${issue.message}`
          )
          .join("; ")
      )
    }
    validateRecipeSemantics(parsed.data, source)
    return parsed.data
  }
}

export function resolveBrick(
  recipe: BrickRecipe,
  input: Readonly<Record<string, BrickVariableValue>>,
  source = recipe.metadata.id
): ResolvedBrick {
  const unknown = Object.keys(input).filter(
    (name) => !Object.hasOwn(recipe.variables, name)
  )
  if (unknown.length > 0) {
    throw recipeError(
      "unknown_variable",
      source,
      `Unknown Brick variable${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`
    )
  }

  const values: Record<string, BrickVariableValue> = {}
  for (const [name, definition] of Object.entries(recipe.variables)) {
    const value = Object.hasOwn(input, name) ? input[name] : definition.default
    if (value === undefined) {
      if (definition.required) {
        throw recipeError(
          "missing_variable",
          source,
          `Brick variable ${name} is required`
        )
      }
      continue
    }
    validateVariable(name, definition, value, source)
    values[name] = value
  }

  const interpolate = (template: string): string =>
    interpolateTemplate(template, recipe, values, source)
  const memory = interpolate(recipe.runtime.resources.memory)
  const memoryReservation = interpolate(
    recipe.runtime.resources.memoryReservation ??
      recipe.runtime.resources.memory
  )
  for (const [name, value] of [
    ["memory", memory],
    ["memoryReservation", memoryReservation],
  ] as const) {
    if (!/^\d+[bkmgt]$/iu.test(value)) {
      throw recipeError(
        "invalid_resource",
        source,
        `Resolved ${name} must be a Docker memory value such as 2G`
      )
    }
  }
  return {
    environment: Object.fromEntries(
      Object.entries(recipe.runtime.environment).map(([name, value]) => [
        name,
        interpolate(value),
      ])
    ),
    memory,
    memoryReservation,
    recipe,
    values,
  }
}

export function interpolateTemplate(
  template: string,
  recipe: BrickRecipe,
  values: Readonly<Record<string, BrickVariableValue>>,
  source = recipe.metadata.id
): string {
  const resolved = template.replace(
    /\{\{\s*(variables\.([a-z][a-z0-9_]{0,47})|brick\.(id|name))\s*\}\}/gu,
    (
      _match,
      _expression: string,
      variable: string | undefined,
      field: string | undefined
    ) => {
      if (variable) {
        if (!Object.hasOwn(values, variable)) {
          throw recipeError(
            "missing_variable",
            source,
            `Template references unresolved variable ${variable}`
          )
        }
        const value = values[variable]
        return String(value)
      }
      return field === "name" ? recipe.metadata.name : recipe.metadata.id
    }
  )
  if (resolved.includes("{{") || resolved.includes("}}")) {
    throw recipeError(
      "invalid_template",
      source,
      `Unsupported template expression in ${template}`
    )
  }
  return resolved
}

function validateVariable(
  name: string,
  definition: BrickVariable,
  value: BrickVariableValue,
  source: string
): void {
  if (typeof value !== definition.type) {
    throw recipeError(
      "invalid_variable",
      source,
      `${name} must be a ${definition.type}`
    )
  }
  if (
    definition.options &&
    !definition.options.some((option) => Object.is(option, value))
  ) {
    throw recipeError(
      "invalid_variable",
      source,
      `${name} must be one of the declared options`
    )
  }
  if (typeof value === "string") {
    const rules = definition.rules
    if (rules?.minLength !== undefined && value.length < rules.minLength) {
      throw recipeError(
        "invalid_variable",
        source,
        `${name} must contain at least ${rules.minLength} characters`
      )
    }
    if (rules?.maxLength !== undefined && value.length > rules.maxLength) {
      throw recipeError(
        "invalid_variable",
        source,
        `${name} must contain at most ${rules.maxLength} characters`
      )
    }
    if (rules?.pattern && !new RegExp(rules.pattern, "u").test(value)) {
      throw recipeError(
        "invalid_variable",
        source,
        `${name} does not match its recipe rule`
      )
    }
  }
  if (typeof value === "number") {
    if (definition.rules?.min !== undefined && value < definition.rules.min) {
      throw recipeError(
        "invalid_variable",
        source,
        `${name} must be at least ${definition.rules.min}`
      )
    }
    if (definition.rules?.max !== undefined && value > definition.rules.max) {
      throw recipeError(
        "invalid_variable",
        source,
        `${name} must be at most ${definition.rules.max}`
      )
    }
  }
}

function validateRecipeSemantics(recipe: BrickRecipe, source: URL): void {
  const primaryPorts = recipe.network.ports.filter(
    (port) => port.name === recipe.network.primaryPort
  )
  if (primaryPorts.length !== 1) {
    throw recipeError(
      "invalid_recipe",
      source.href,
      "network.primaryPort must name exactly one declared port"
    )
  }
  const portNames = new Set<string>()
  for (const port of recipe.network.ports) {
    if (portNames.has(port.name)) {
      throw recipeError(
        "invalid_recipe",
        source.href,
        `Duplicate network port name ${port.name}`
      )
    }
    portNames.add(port.name)
  }
  for (const [name, definition] of Object.entries(recipe.variables)) {
    if (
      definition.default !== undefined &&
      typeof definition.default !== definition.type
    ) {
      throw recipeError(
        "invalid_recipe",
        source.href,
        `${name}.default does not match its declared type`
      )
    }
    for (const option of definition.options ?? []) {
      if (typeof option !== definition.type) {
        throw recipeError(
          "invalid_recipe",
          source.href,
          `${name}.options does not match its declared type`
        )
      }
    }
    if (definition.rules?.pattern) {
      try {
        new RegExp(definition.rules.pattern, "u")
      } catch {
        throw recipeError(
          "invalid_recipe",
          source.href,
          `${name}.rules.pattern is not a valid regular expression`
        )
      }
    }
  }
}

function parseCatalog(text: string): BrickCatalogDocument {
  const source = new URL("https://catalog.invalid/catalog.yml")
  const parsed = brickCatalogDocumentSchema.safeParse(parseYaml(text, source))
  if (!parsed.success) {
    throw recipeError(
      "invalid_catalog",
      "catalog",
      parsed.error.issues
        .slice(0, 4)
        .map(
          (issue) => `${issue.path.join(".") || "catalog"}: ${issue.message}`
        )
        .join("; ")
    )
  }
  return parsed.data
}

function parseYaml(text: string, source: URL): unknown {
  const document = parseDocument(text, {
    prettyErrors: true,
    uniqueKeys: true,
  })
  if (document.errors.length > 0) {
    throw recipeError(
      "invalid_yaml",
      source.href,
      document.errors[0]?.message ?? "Invalid YAML"
    )
  }
  return document.toJS({ maxAliasCount: 20 })
}

async function readDocument(
  source: URL,
  configuredCatalog: URL
): Promise<string> {
  if (source.protocol === "file:") {
    validateLocalSource(source, configuredCatalog)
    const content = await readFile(fileURLToPath(source), "utf8")
    if (Buffer.byteLength(content) > MAX_DOCUMENT_BYTES) {
      throw recipeError(
        "document_too_large",
        source.href,
        "Brick document exceeds 1 MiB"
      )
    }
    return content
  }
  if (source.protocol !== "https:") {
    throw recipeError(
      "insecure_recipe_source",
      source.href,
      "Brick documents must use HTTPS"
    )
  }
  let response: Response
  try {
    response = await fetch(source, {
      headers: { Accept: "application/yaml, text/yaml, application/json" },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (cause) {
    throw recipeError(
      "recipe_fetch_failed",
      source.href,
      cause instanceof Error ? cause.message : "Could not fetch Brick source"
    )
  }
  if (new URL(response.url).protocol !== "https:") {
    throw recipeError(
      "insecure_recipe_redirect",
      source.href,
      "Brick source redirected away from HTTPS"
    )
  }
  if (!response.ok) {
    throw recipeError(
      "recipe_fetch_failed",
      source.href,
      `Brick source returned HTTP ${response.status}`
    )
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0)
  if (declaredLength > MAX_DOCUMENT_BYTES) {
    throw recipeError(
      "document_too_large",
      source.href,
      "Brick document exceeds 1 MiB"
    )
  }
  const content = await response.text()
  if (Buffer.byteLength(content) > MAX_DOCUMENT_BYTES) {
    throw recipeError(
      "document_too_large",
      source.href,
      "Brick document exceeds 1 MiB"
    )
  }
  return content
}

function validateLocalSource(source: URL, configuredCatalog: URL): void {
  if (configuredCatalog.protocol !== "file:") {
    throw recipeError(
      "local_recipe_forbidden",
      source.href,
      "Local recipes require an explicitly configured file catalog"
    )
  }
  const root = dirname(resolve(fileURLToPath(configuredCatalog)))
  const candidate = resolve(fileURLToPath(source))
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw recipeError(
      "local_recipe_forbidden",
      source.href,
      "Local recipe must be inside the configured catalog directory"
    )
  }
}

function validateCatalogProtocol(url: URL): void {
  if (url.protocol !== "https:" && url.protocol !== "file:") {
    throw recipeError(
      "insecure_catalog_source",
      url.href,
      "Brick catalog must use HTTPS or an explicitly configured file URL"
    )
  }
}

function parseUrl(value: string, base: string | URL): URL {
  try {
    return new URL(value, base instanceof URL ? base : undefined)
  } catch {
    throw recipeError("invalid_recipe_url", value, `Invalid ${String(base)}`)
  }
}

function recipeError(
  code: string,
  source: string,
  reason: string
): BrickRecipeError {
  return BrickRecipeError.make({ code, source, reason })
}
