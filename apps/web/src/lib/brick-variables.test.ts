import { describe, expect, it } from "vite-plus/test"
import {
  brickRecipeSchema,
  requiredMinecraftJavaVersion,
} from "@workspace/contracts"

import {
  defaultBrickVariables,
  hydrateBrickVariables,
  unavailableMinecraftJavaVersion,
  withRecommendedMinecraftJava,
} from "./brick-variables.js"

const paper = brickRecipeSchema.parse({
  format: "kiln.brick/v1",
  metadata: {
    id: "paper",
    name: "Paper",
    description: "Paper test recipe.",
    game: "Minecraft",
    author: "Kiln",
  },
  variables: {
    version: {
      type: "string",
      label: "Minecraft version",
      description: "Paper release to install.",
      required: true,
      default: "1.21.11",
    },
    java_version: {
      type: "string",
      label: "Java version",
      description: "Java Ember release.",
      required: true,
      default: "17",
      rules: { pattern: "^(?:11|17|21|25)$" },
    },
  },
  runtime: {
    image: "ghcr.io/kiln-site/bricks-java:{{ variables.java_version }}",
    name: "Java {{ variables.java_version }}",
    environment: {},
    resources: { memory: "2G" },
    storage: { mount: "/server" },
  },
  network: {
    mode: "minecraft-backend",
    primaryPort: "game",
    ports: [{ name: "game", container: 25_565, protocol: "tcp" }],
  },
  constraints: {},
})

describe("Minecraft Java defaults", () => {
  it.each([
    ["paper", "1.16.4", "11"],
    ["paper", "1.17.1", "17"],
    ["paper", "1.21.11", "21"],
    ["paper", "26.2", "25"],
    ["folia", "26.1", "25"],
    ["fabric", "1.17.1", "17"],
    ["fabric", "1.20.4", "17"],
    ["fabric", "1.20.5", "21"],
    ["fabric", "26.2", "25"],
  ])("maps %s %s to Java %s", (brickId, version, javaVersion) => {
    expect(requiredMinecraftJavaVersion(brickId, version)).toBe(javaVersion)
  })

  it("derives Java from the default and selected Minecraft versions", () => {
    expect(defaultBrickVariables({ ...paper, source: "paper.yml" })).toEqual({
      version: "1.21.11",
      java_version: "21",
    })
    expect(
      withRecommendedMinecraftJava("paper", paper.variables, {
        version: "26.2",
        java_version: "21",
      })
    ).toEqual({ version: "26.2", java_version: "25" })
  })

  it("hydrates missing legacy Startup variables without replacing overrides", () => {
    expect(
      hydrateBrickVariables(
        { ...paper, source: "paper.yml" },
        { version: "26.2" }
      )
    ).toEqual({ version: "26.2", java_version: "25" })
    expect(
      hydrateBrickVariables(
        { ...paper, source: "paper.yml" },
        { java_version: "21", version: "26.2" }
      )
    ).toEqual({ version: "26.2", java_version: "21" })
  })

  it("reports required Java Embers that are not published", () => {
    expect(
      unavailableMinecraftJavaVersion("paper", paper.variables, "1.16.5")
    ).toBe("16")
    expect(
      unavailableMinecraftJavaVersion("paper", paper.variables, "1.21.11")
    ).toBeNull()
  })
})
