import { it as effectIt } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect, it } from "vite-plus/test"

import {
  KILN_IMAGE_SOURCE,
  managedImageChannel,
  replaceContainerEffect,
  type ContainerInspect,
  type ContainerUpdateDocker,
  type ImageInspect,
} from "./update-container.js"

const currentContainerId = "a".repeat(64)
const currentContainer: ContainerInspect = {
  Config: {
    Cmd: ["old-command"],
    Entrypoint: ["old-entrypoint"],
    Env: ["EXAMPLE=true"],
    Healthcheck: {
      Interval: 10_000_000_000,
      Test: ["CMD", "old-healthcheck"],
    },
    Hostname: currentContainerId.slice(0, 12),
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
  Id: currentContainerId,
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
  failCommand: string | null = null
  failHealthCheck = false

  constructor(readonly current: ContainerInspect = currentContainer) {}

  async command(
    arguments_: Array<string>
  ): Promise<{ stderr: string; stdout: string }> {
    this.commands.push(arguments_)
    if (arguments_.join(" ") === this.failCommand) {
      throw new Error(`command failed: ${this.failCommand}`)
    }
    return { stderr: "", stdout: "" }
  }

  async createContainer(_name: string, configuration: unknown): Promise<void> {
    this.createdConfiguration = configuration
  }

  async inspectContainer(): Promise<ContainerInspect> {
    return this.current
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
  effectIt.effect(
    "refreshes image metadata and Docker's generated hostname",
    () =>
      Effect.gen(function* () {
        const docker = new FakeDocker()

        yield* replaceContainerEffect(
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
        expect(docker.createdConfiguration).not.toHaveProperty("Hostname")
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
        expect(docker.commands.at(-1)).toEqual([
          "rm",
          "--force",
          "hearth-backup",
        ])
      })
  )

  effectIt.effect("preserves an explicitly configured hostname", () =>
    Effect.gen(function* () {
      const docker = new FakeDocker({
        ...currentContainer,
        Config: {
          ...currentContainer.Config,
          Hostname: "hearth.internal",
        },
      })

      yield* replaceContainerEffect(
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
        expect.objectContaining({ Hostname: "hearth.internal" })
      )
    })
  )

  effectIt.effect(
    "records the stable release version for a promoted nightly image",
    () =>
      Effect.gen(function* () {
        const docker = new FakeDocker()

        yield* replaceContainerEffect(
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
  )

  effectIt.effect(
    "restores the old container and channel image after a failed health check",
    () =>
      Effect.gen(function* () {
        const docker = new FakeDocker()
        docker.failHealthCheck = true

        const failure = yield* replaceContainerEffect(
          {
            backupName: "hearth-backup",
            targetContainer: "hearth",
            targetImage: `ghcr.io/kiln-site/hearth@sha256:${"c".repeat(64)}`,
            targetReference: "ghcr.io/kiln-site/hearth:latest-nightly",
            targetVersion: "0.1.0-nightly.2",
          },
          docker
        ).pipe(Effect.flip)

        expect(failure.message).toContain("unhealthy")
        expect(failure.phase).toBe("replace")
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
  )

  effectIt.effect(
    "attempts every rollback step and reports rollback failures",
    () =>
      Effect.gen(function* () {
        const docker = new FakeDocker()
        docker.failHealthCheck = true
        docker.failCommand = "rm --force hearth"

        const failure = yield* replaceContainerEffect(
          {
            backupName: "hearth-backup",
            targetContainer: "hearth",
            targetImage: `ghcr.io/kiln-site/hearth@sha256:${"c".repeat(64)}`,
            targetReference: "ghcr.io/kiln-site/hearth:latest-nightly",
            targetVersion: "0.1.0-nightly.2",
          },
          docker
        ).pipe(Effect.flip)

        expect(failure.rollbackFailures).toHaveLength(1)
        expect(failure.message).toContain("command failed: rm --force hearth")
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
  )
})
