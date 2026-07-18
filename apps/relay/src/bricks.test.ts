import { describe, expect, it } from "vitest"
import { brickRecipeSchema } from "@workspace/contracts"

import { BrickRecipeError } from "./effect/errors.js"
import {
  interpolateTemplate,
  isPublicRecipeAddress,
  resolveBrick,
} from "./bricks.js"
import type { BrickRecipe } from "@workspace/contracts"

const recipe: BrickRecipe = brickRecipeSchema.parse({
  format: "kiln.brick/v1",
  metadata: {
    id: "example",
    name: "Example",
    description: "A test Brick recipe.",
    game: "Example Game",
    author: "Kiln",
  },
  variables: {
    version: {
      type: "string",
      label: "Version",
      description: "Release to install.",
      required: true,
      default: "1.2.3",
      rules: { pattern: "^[0-9.]+$" },
    },
    memory: {
      type: "string",
      label: "Memory",
      description: "Memory allocation.",
      required: true,
      default: "2G",
      options: ["2G", "4G"],
    },
    debug: {
      type: "boolean",
      label: "Debug",
      description: "Enable debug output.",
      required: false,
      default: false,
    },
  },
  runtime: {
    image: "registry.example.com/custom/server:latest",
    name: "Custom runtime",
    environment: {
      VERSION: "{{ variables.version }}",
      DEBUG: "{{ variables.debug }}",
      BRICK: "{{ brick.id }}",
    },
    resources: {
      memory: "{{ variables.memory }}",
      memoryReservation: "{{ variables.memory }}",
      pids: 128,
    },
    storage: { mount: "/server" },
  },
  network: {
    mode: "direct",
    primaryPort: "game",
    hostname: "{{ brick.id }}",
    ports: [{ name: "game", container: 7777, protocol: "udp" }],
  },
})

describe("Brick recipes", () => {
  it("resolves defaults, overrides, resources, and literal templates", () => {
    const resolved = resolveBrick(recipe, { memory: "4G" })
    expect(resolved.values).toEqual({
      version: "1.2.3",
      memory: "4G",
      debug: false,
    })
    expect(resolved.environment).toEqual({
      VERSION: "1.2.3",
      DEBUG: "false",
      BRICK: "example",
    })
    expect(resolved.memory).toBe("4G")
    expect(
      interpolateTemplate("{{ variables.version }}.{{ brick.id }}", recipe, {
        version: "2.0",
      })
    ).toBe("2.0.example")
  })

  it("rejects undeclared and invalid variable values", () => {
    expect(() => resolveBrick(recipe, { unknown: "value" })).toThrow(
      BrickRecipeError
    )
    expect(() => resolveBrick(recipe, { memory: "8G" })).toThrow(
      /declared options/u
    )
    expect(() => resolveBrick(recipe, { version: "latest" })).toThrow(
      /recipe rule/u
    )
  })

  it("rejects expressions because templates are not executable", () => {
    expect(() =>
      interpolateTemplate("{{ variables.version.toString() }}", recipe, {})
    ).toThrow(/Unsupported template expression/u)
  })

  it("blocks private and reserved recipe network addresses", () => {
    expect(isPublicRecipeAddress("8.8.8.8")).toBe(true)
    expect(isPublicRecipeAddress("2606:4700:4700::1111")).toBe(true)
    expect(isPublicRecipeAddress("127.0.0.1")).toBe(false)
    expect(isPublicRecipeAddress("10.42.0.1")).toBe(false)
    expect(isPublicRecipeAddress("169.254.169.254")).toBe(false)
    expect(isPublicRecipeAddress("::1")).toBe(false)
    expect(isPublicRecipeAddress("::ffff:7f00:1")).toBe(false)
  })
})
