export const KILN_IMAGE_SOURCE = "https://github.com/kiln-site/hearth"

export type KilnComponent = "hearth" | "relay"

export interface ContainerInspect {
  Config: Record<string, unknown> & {
    Healthcheck?: unknown
    Image?: string
    Labels?: Record<string, string> | null
  }
  HostConfig: Record<string, unknown> & {
    NetworkMode?: string
  }
  Image: string
  Name: string
  NetworkSettings?: {
    Networks?: Record<string, { Aliases?: Array<string> | null }>
  }
  State: {
    Health?: { Status?: string }
    Running: boolean
  }
}

export interface ImageInspect {
  Config?: {
    Healthcheck?: unknown
    Labels?: Record<string, string> | null
  }
}

export interface ContainerUpdateDocker {
  command(
    arguments_: Array<string>,
    timeout?: number
  ): Promise<{ stderr: string; stdout: string }>
  createContainer(name: string, configuration: unknown): Promise<void>
  inspectContainer(container: string): Promise<ContainerInspect>
  inspectImage(image: string): Promise<ImageInspect>
  waitUntilHealthy(container: string): Promise<void>
}

export function kilnComponent(value: string | undefined): KilnComponent | null {
  return value === "hearth" || value === "relay" ? value : null
}

export function managedImageChannel(
  image: string,
  component: KilnComponent
): string | null {
  const stable = `ghcr.io/kiln-site/${component}:latest`
  const nightly = `ghcr.io/kiln-site/${component}:latest-nightly`
  return image === stable || image === nightly ? image : null
}

export async function replaceContainer(
  input: {
    backupName: string
    targetContainer: string
    targetImage: string
    targetReference: string
    targetVersion: string
  },
  docker: ContainerUpdateDocker
): Promise<void> {
  const current = await docker.inspectContainer(input.targetContainer)
  const target = await docker.inspectImage(input.targetImage)
  const networks = current.NetworkSettings?.Networks ?? {}
  const networkNames = Object.keys(networks)
  const configuredNetwork = current.HostConfig.NetworkMode
  const primaryNetwork =
    configuredNetwork && Object.hasOwn(networks, configuredNetwork)
      ? configuredNetwork
      : networkNames[0]
  if (!primaryNetwork) {
    throw new Error("The target has no Docker network to preserve")
  }

  let replacementCreated = false
  let backupRenamed = false
  try {
    await docker.command([
      "image",
      "tag",
      input.targetImage,
      input.targetReference,
    ])
    await docker.command(
      ["stop", "--time", "30", input.targetContainer],
      45_000
    )
    await docker.command(["rename", input.targetContainer, input.backupName])
    backupRenamed = true

    const preservedConfig = { ...current.Config }
    delete preservedConfig.Healthcheck
    const targetHealthcheck = target.Config?.Healthcheck
    await docker.createContainer(input.targetContainer, {
      ...preservedConfig,
      Image: input.targetReference,
      Labels: {
        ...current.Config.Labels,
        ...target.Config?.Labels,
        "org.opencontainers.image.version": input.targetVersion,
      },
      ...(targetHealthcheck === undefined
        ? {}
        : { Healthcheck: targetHealthcheck }),
      HostConfig: {
        ...current.HostConfig,
        NetworkMode: primaryNetwork,
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [primaryNetwork]: {
            Aliases: networkAliases(
              networks[primaryNetwork]?.Aliases,
              input.targetContainer
            ),
          },
        },
      },
    })
    replacementCreated = true

    for (const network of networkNames) {
      if (network === primaryNetwork) continue
      const arguments_ = ["network", "connect"]
      for (const alias of networkAliases(
        networks[network]?.Aliases,
        input.targetContainer
      )) {
        arguments_.push("--alias", alias)
      }
      arguments_.push(network, input.targetContainer)
      await docker.command(arguments_)
    }

    await docker.command(["start", input.targetContainer], 120_000)
    await docker.waitUntilHealthy(input.targetContainer)
    await docker.command(["rm", "--force", input.backupName], 90_000)
  } catch (cause) {
    if (replacementCreated) {
      await docker
        .command(["rm", "--force", input.targetContainer], 90_000)
        .catch(() => undefined)
    }
    if (backupRenamed) {
      await docker
        .command(["rename", input.backupName, input.targetContainer])
        .catch(() => undefined)
      await docker
        .command(["start", input.targetContainer], 120_000)
        .catch(() => undefined)
    }
    await docker
      .command(["image", "tag", current.Image, input.targetReference])
      .catch(() => undefined)
    throw cause
  }
}

function networkAliases(
  aliases: Array<string> | null | undefined,
  targetContainer: string
): Array<string> {
  return Array.from(
    new Set([
      ...(aliases ?? []).filter((alias) => !/^[a-f0-9]{12,64}$/u.test(alias)),
      targetContainer,
    ])
  )
}
