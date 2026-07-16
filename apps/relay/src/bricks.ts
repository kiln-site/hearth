import type { Brick, BrickId } from "@workspace/contracts"

export const BRICKS: ReadonlyArray<Brick> = [
  {
    id: "paper",
    name: "Paper",
    description: "Fast, plugin-compatible Minecraft server for most projects.",
    image: "ghcr.io/kiln-site/ember:java21",
    proxy: false,
    defaultVersion: "1.21.11",
    defaultMemory: "2G",
    javaVersion: "21",
  },
  {
    id: "folia",
    name: "Folia",
    description:
      "Paper's regionized multithreaded server for concurrency testing.",
    image: "ghcr.io/kiln-site/ember:java21",
    proxy: false,
    defaultVersion: "1.21.11",
    defaultMemory: "3G",
    javaVersion: "21",
  },
  {
    id: "fabric",
    name: "Fabric",
    description:
      "Minimal mod-loader runtime with automatic loader provisioning.",
    image: "ghcr.io/kiln-site/ember:java21",
    proxy: false,
    defaultVersion: "1.21.11",
    defaultMemory: "2G",
    javaVersion: "21",
  },
  {
    id: "velocity",
    name: "Velocity",
    description: "Modern Minecraft proxy and hostname entrypoint for a node.",
    image: "ghcr.io/kiln-site/ember:java21",
    proxy: true,
    defaultVersion: "3.5.1",
    defaultMemory: "1G",
    javaVersion: "21",
  },
]

export function brick(id: BrickId): Brick {
  const found = BRICKS.find((item) => item.id === id)
  if (!found) throw new Error(`Unknown Brick ${id}`)
  return found
}
