import { describe, expect, it } from "vite-plus/test"

import {
  KILN_IMAGE_SOURCE,
  managedImageChannel,
  replaceContainer,
  type ContainerInspect,
  type ContainerUpdateDocker,
  type ImageInspect,
} from "./update-container.js"

const currentContainer: ContainerInspect = {
  Config: {
    Cmd: ["old-command"],
    Entrypoint: ["old-entrypoint"],
    Env: ["EXAMPLE=true"],
    Healthcheck: {
      Interval: 10_000_000_000,
      Test: ["CMD", "old-healthcheck"],
    },
    Image: "ghcr.io/kiln-site/hearth:latest-nightly",
    Labels: {
      "coolify.managed": "true",
      "io.kiln.component": "hearth",
      "org.opencontainers.image.revision": "old-commit",
      "org.opencontainers.image.source": KILN_IMAGE_SOURCE,
      "org.opencontainers.image.version": "0.1.0-nightly.1",
    },
  },
  HostConfig: {
    NetworkMode: "kiln",
    RestartPolicy: { Name: "unless-stopped" },
  },
  Image: "sha256:old-image",
  Name: "/hearth",
  NetworkSettings: {
    Networks: {
      edge: { Aliases: ["hearth-edge", "b".repeat(64)] },
      kiln: { Aliases: ["hearth", "a".repeat(64)] },
    },
  },
  State: {
    Running: true,
  },
}

const targetImage: ImageInspect = {
  Config: {
    Healthcheck: {
      Interval: 5_000_000_000,
      Test: ["CMD", "new-healthcheck"],
    },
    Labels: {
      "io.kiln.component": "hearth",
      "org.opencontainers.image.revision": "new-commit",
      "org.opencontainers.image.source": KILN_IMAGE_SOURCE,
      "org.opencontainers.image.version": "0.1.0-nightly.2",
    },
  },
}

class FakeDocker implements ContainerUpdateDocker {
  readonly commands: Array<Array<string>> = []
  createdConfiguration: unknown = null
  failHealthCheck = false

  async command(
    arguments_: Array<string>
  ): Promise<{ stderr: string; stdout: string }> {
    this.commands.push(arguments_)
    return { stderr: "", stdout: "" }
  }

  async createContainer(_name: string, configuration: unknown): Promise<void> {
    this.createdConfiguration = configuration
  }

  async inspectContainer(): Promise<ContainerInspect> {
    return currentContainer
  }

  async inspectImage(): Promise<ImageInspect> {
    return targetImage
  }

  async waitUntilHealthy(): Promise<void> {
    if (this.failHealthCheck) {
      throw new Error("unhealthy")
    }
  }
}

describe("managed update channels", () => {
  it("accepts only the matching floating channel tags", () => {
    expect(
      managedImageChannel("ghcr.io/kiln-site/hearth:latest", "hearth")
    ).toBe("ghcr.io/kiln-site/hearth:latest")
    expect(
      managedImageChannel("ghcr.io/kiln-site/hearth:latest-nightly", "hearth")
    ).toBe("ghcr.io/kiln-site/hearth:latest-nightly")
    expect(
      managedImageChannel("ghcr.io/kiln-site/hearth:0.1.0", "hearth")
    ).toBeNull()
    expect(
      managedImageChannel(
        `ghcr.io/kiln-site/hearth@sha256:${"a".repeat(64)}`,
        "hearth"
      )
    ).toBeNull()
    expect(
      managedImageChannel("ghcr.io/kiln-site/relay:latest", "hearth")
    ).toBeNull()
  })
})

describe("container replacement", () => {
  it("keeps the channel reference and refreshes image metadata", async () => {
    const docker = new FakeDocker()

    await replaceContainer(
      {
        backupName: "hearth-backup",
        targetContainer: "hearth",
        targetImage: `ghcr.io/kiln-site/hearth@sha256:${"c".repeat(64)}`,
        targetReference: "ghcr.io/kiln-site/hearth:latest-nightly",
        targetVersion: "0.1.0-nightly.2",
      },
      docker
    )

    expect(docker.createdConfiguration).toEqual(
      expect.objectContaining({
        Image: "ghcr.io/kiln-site/hearth:latest-nightly",
        Healthcheck: {
          Interval: 5_000_000_000,
          Test: ["CMD", "new-healthcheck"],
        },
        Labels: {
          "coolify.managed": "true",
          "io.kiln.component": "hearth",
          "org.opencontainers.image.revision": "new-commit",
          "org.opencontainers.image.source": KILN_IMAGE_SOURCE,
          "org.opencontainers.image.version": "0.1.0-nightly.2",
        },
      })
    )
    expect(docker.createdConfiguration).not.toHaveProperty("Cmd")
    expect(docker.createdConfiguration).not.toHaveProperty("Entrypoint")
    expect(docker.commands[0]).toEqual([
      "image",
      "tag",
      `ghcr.io/kiln-site/hearth@sha256:${"c".repeat(64)}`,
      "ghcr.io/kiln-site/hearth:latest-nightly",
    ])
    expect(docker.commands).toContainEqual([
      "network",
      "connect",
      "--alias",
      "hearth-edge",
      "--alias",
      "hearth",
      "edge",
      "hearth",
    ])
    expect(docker.commands.at(-1)).toEqual(["rm", "--force", "hearth-backup"])
  })

  it("records the stable release version for a promoted nightly image", async () => {
    const docker = new FakeDocker()

    await replaceContainer(
      {
        backupName: "hearth-backup",
        targetContainer: "hearth",
        targetImage: `ghcr.io/kiln-site/hearth@sha256:${"c".repeat(64)}`,
        targetReference: "ghcr.io/kiln-site/hearth:latest",
        targetVersion: "0.1.0",
      },
      docker
    )

    expect(docker.createdConfiguration).toEqual(
      expect.objectContaining({
        Labels: expect.objectContaining({
          "org.opencontainers.image.version": "0.1.0",
        }),
      })
    )
  })

  it("restores the old container and channel image after a failed health check", async () => {
    const docker = new FakeDocker()
    docker.failHealthCheck = true

    await expect(
      replaceContainer(
        {
          backupName: "hearth-backup",
          targetContainer: "hearth",
          targetImage: `ghcr.io/kiln-site/hearth@sha256:${"c".repeat(64)}`,
          targetReference: "ghcr.io/kiln-site/hearth:latest-nightly",
          targetVersion: "0.1.0-nightly.2",
        },
        docker
      )
    ).rejects.toThrow("unhealthy")

    expect(docker.commands).toContainEqual(["rm", "--force", "hearth"])
    expect(docker.commands).toContainEqual([
      "rename",
      "hearth-backup",
      "hearth",
    ])
    expect(docker.commands).toContainEqual(["start", "hearth"])
    expect(docker.commands.at(-1)).toEqual([
      "image",
      "tag",
      "sha256:old-image",
      "ghcr.io/kiln-site/hearth:latest-nightly",
    ])
  })
})
