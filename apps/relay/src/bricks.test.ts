import { IncomingMessage } from "node:http"
import { Socket } from "node:net"

import { describe, expect, it } from "vite-plus/test"
import { brickRecipeSchema } from "@workspace/contracts"

import { BrickRecipeError } from "./effect/errors.js"
import {
  interpolateTemplate,
  isPublicRecipeAddress,
  readResponseDocument,
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
    java_version: {
      type: "string",
      label: "Java version",
      description: "JDK release used to run the server.",
      required: true,
      default: "21",
      options: ["11", "17", "21", "25"],
    },
  },
  runtime: {
    image: "registry.example.com/custom/server:{{ variables.java_version }}",
    name: "Java {{ variables.java_version }}",
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
  readiness: {
    logs: [" Server ready "],
  },
  console: {
    stopCommands: [" stop ", "/stop"],
  },
})

describe("Brick recipes", () => {
  it("normalizes literal startup readiness logs", () => {
    expect(recipe.readiness?.logs).toEqual(["Server ready"])
  })

  it("normalizes exact console stop commands", () => {
    expect(recipe.console?.stopCommands).toEqual(["stop", "/stop"])
  })

  it("defaults SRV support off and accepts an explicit opt-in", () => {
    expect(recipe.network.supportsSrv).toBe(false)
    expect(
      brickRecipeSchema.parse({
        ...recipe,
        network: { ...recipe.network, supportsSrv: true },
      }).network.supportsSrv
    ).toBe(true)
  })

  it("resolves defaults, overrides, resources, and literal templates", () => {
    const resolved = resolveBrick(recipe, { memory: "4G" })
    expect(resolved.values).toEqual({
      version: "1.2.3",
      memory: "4G",
      debug: false,
      java_version: "21",
    })
    expect(resolved.environment).toEqual({
      VERSION: "1.2.3",
      DEBUG: "false",
      BRICK: "example",
    })
    expect(resolved.memory).toBe("4G")
    expect(resolved.image).toBe("registry.example.com/custom/server:21")
    expect(resolved.runtimeName).toBe("Java 21")
    const java25 = resolveBrick(recipe, {
      java_version: "25",
      memory: "4G",
    })
    expect(java25.image).toBe("registry.example.com/custom/server:25")
    expect(java25.runtimeName).toBe("Java 25")
    expect(
      interpolateTemplate("{{ variables.version }}.{{ brick.id }}", recipe, {
        version: "2.0",
      })
    ).toBe("2.0.example")
  })

  it("derives the Java Ember from Minecraft unless explicitly overridden", () => {
    const paper = brickRecipeSchema.parse({
      ...recipe,
      metadata: { ...recipe.metadata, game: "Minecraft", id: "paper" },
      variables: {
        ...recipe.variables,
        version: { ...recipe.variables.version, default: "1.21.11" },
        java_version: {
          ...recipe.variables.java_version,
          options: undefined,
          rules: { pattern: "^(?:11|17|21|25)$" },
        },
      },
    })

    expect(resolveBrick(paper, { version: "26.2" }).values.java_version).toBe(
      "25"
    )
    expect(
      resolveBrick(paper, { java_version: "21", version: "26.2" }).values
        .java_version
    ).toBe("21")
    expect(() => resolveBrick(paper, { version: "1.16.5" })).toThrow(
      /requires Java 16/u
    )
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

  it("turns response stream errors into typed recipe failures", async () => {
    const response = new IncomingMessage(new Socket())
    const document = readResponseDocument(
      response,
      "https://example.com/recipe.yml"
    )

    response.emit("error", new Error("socket reset during response"))

    await expect(document).rejects.toMatchObject({
      code: "recipe_fetch_failed",
      source: "https://example.com/recipe.yml",
      reason: "socket reset during response",
    })
  })
})
