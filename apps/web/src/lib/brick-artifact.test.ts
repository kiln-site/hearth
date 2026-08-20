import { describe, expect, it } from "vite-plus/test"
import { brickRecipeSchema } from "@workspace/contracts"

import { brickArtifactCatalog } from "./brick-artifact.js"

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
  },
  runtime: {
    image: "ghcr.io/kiln-site/bricks-java:21",
    name: "Java 21",
    environment: {
      KILN_ARTIFACT_URL:
        "https://mcjarfiles.com/api/get-jar/servers/paper/{{ variables.version }}",
    },
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

describe("brick artifact catalog", () => {
  it("reads the mcjarfiles type and variant from the Brick artifact URL", () => {
    expect(brickArtifactCatalog(paper)).toEqual({
      type: "servers",
      variant: "paper",
    })
  })

  it("ignores Bricks without a versioned mcjarfiles artifact URL", () => {
    expect(
      brickArtifactCatalog({
        ...paper,
        runtime: {
          ...paper.runtime,
          environment: {
            KILN_ARTIFACT_URL: "https://example.test/paper.jar",
          },
        },
      })
    ).toBeNull()
  })
})
