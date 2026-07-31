export const KILN_IMAGE_SOURCE = "https://github.com/kiln-site/hearth"
export const KILN_INSTALLATION_LABEL = "io.kiln.installation"

export type KilnComponent = "hearth" | "relay"

export interface ContainerInspect {
  Config: Record<string, unknown> & {
    Cmd?: unknown
    Entrypoint?: unknown
    Healthcheck?: unknown
    Hostname?: string
    Image?: string
    Labels?: Record<string, string> | null
  }
  HostConfig: Record<string, unknown> & {
    NetworkMode?: string
  }
  Id: string
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

export function replaceContainerEffect(
  input: {
    backupName: string
    targetContainer: string
    targetImage: string
    targetReference: string
    targetVersion: string
  },
  docker: ContainerUpdateDocker
) {
  return Effect.gen(function* () {
    const [current, target] = yield* Effect.all(
      [
        updateOperation("replace.inspectContainer", () =>
          docker.inspectContainer(input.targetContainer)
        ),
        updateOperation("replace.inspectImage", () =>
          docker.inspectImage(input.targetImage)
        ),
      ] as const,
      { concurrency: 2 }
    )
    const networks = current.NetworkSettings?.Networks ?? {}
    const networkNames = Object.keys(networks)
    const configuredNetwork = current.HostConfig.NetworkMode
    const primaryNetwork =
      configuredNetwork && Object.hasOwn(networks, configuredNetwork)
        ? configuredNetwork
        : networkNames[0]
    if (!primaryNetwork) {
      return yield* updateFailure(
        "replace.validate",
        "The target has no Docker network to preserve"
      )
    }

    let replacementCreated = false
    let backupRenamed = false
    yield* Effect.gen(function* () {
      yield* updateOperation("replace.tagTarget", () =>
        docker.command([
          "image",
          "tag",
          input.targetImage,
          input.targetReference,
        ])
      )
      yield* updateOperation("replace.stopCurrent", () =>
        docker.command(["stop", "--time", "30", input.targetContainer], 45_000)
      )
      yield* updateOperation("replace.renameCurrent", () =>
        docker.command(["rename", input.targetContainer, input.backupName])
      )
      backupRenamed = true

      const preservedConfig = { ...current.Config }
      delete preservedConfig.Cmd
      delete preservedConfig.Entrypoint
      delete preservedConfig.Healthcheck
      // Docker's default hostname is the old container ID. Let Docker
      // regenerate it after the old container becomes the backup.
      if (isDockerGeneratedHostname(current.Config.Hostname, current.Id)) {
        delete preservedConfig.Hostname
      }
      const targetHealthcheck = target.Config?.Healthcheck
      yield* updateOperation("replace.createTarget", () =>
        docker.createContainer(input.targetContainer, {
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
      )
      replacementCreated = true

      yield* Effect.forEach(
        networkNames.filter((network) => network !== primaryNetwork),
        (network) => {
          const arguments_ = ["network", "connect"]
          for (const alias of networkAliases(
            networks[network]?.Aliases,
            input.targetContainer
          )) {
            arguments_.push("--alias", alias)
          }
          arguments_.push(network, input.targetContainer)
          return updateOperation("replace.connectNetwork", () =>
            docker.command(arguments_)
          )
        },
        { discard: true }
      )

      yield* updateOperation("replace.startTarget", () =>
        docker.command(["start", input.targetContainer], 120_000)
      )
      yield* updateOperation("replace.waitUntilHealthy", () =>
        docker.waitUntilHealthy(input.targetContainer)
      )
      yield* updateOperation("replace.removeBackup", () =>
        docker.command(["rm", "--force", input.backupName], 90_000)
      )
    }).pipe(
      Effect.catch((cause) =>
        rollbackContainerReplacementEffect(
          input,
          current,
          docker,
          replacementCreated,
          backupRenamed
        ).pipe(
          Effect.flatMap((rollbackFailures) =>
            Effect.fail(
              RelaySystemUpdateError.make({
                phase: "replace",
                reason: cause.message,
                cause,
                rollbackFailures,
              })
            )
          )
        )
      ),
      Effect.uninterruptible
    )
  }).pipe(Effect.withSpan("relay.update.replaceContainer"))
}

const rollbackContainerReplacementEffect = Effect.fn(
  "relay.update.rollbackContainer"
)(function* (
  input: {
    backupName: string
    targetContainer: string
    targetReference: string
  },
  current: ContainerInspect,
  docker: ContainerUpdateDocker,
  replacementCreated: boolean,
  backupRenamed: boolean
) {
  const rollbackFailures: Array<string> = []
  const operations = [
    ...(replacementCreated
      ? [
          updateOperation("rollback.removeReplacement", () =>
            docker.command(["rm", "--force", input.targetContainer], 90_000)
          ),
        ]
      : []),
    ...(backupRenamed
      ? [
          updateOperation("rollback.restoreBackup", () =>
            docker.command(["rename", input.backupName, input.targetContainer])
          ).pipe(
            Effect.andThen(
              updateOperation("rollback.startBackup", () =>
                docker.command(["start", input.targetContainer], 120_000)
              )
            )
          ),
        ]
      : []),
    updateOperation("rollback.restoreReference", () =>
      docker.command(["image", "tag", current.Image, input.targetReference])
    ),
  ]
  yield* Effect.forEach(
    operations,
    (operation) =>
      operation.pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            rollbackFailures.push(error.message)
          })
        )
      ),
    { discard: true }
  )
  return rollbackFailures
})

function updateOperation<TResult>(phase: string, run: () => Promise<TResult>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      cause instanceof RelaySystemUpdateError
        ? cause
        : RelaySystemUpdateError.make({
            phase,
            reason:
              cause instanceof Error ? cause.message : "System update failed",
            cause,
            rollbackFailures: [],
          }),
  })
}

function updateFailure(phase: string, reason: string) {
  return Effect.fail(
    RelaySystemUpdateError.make({
      phase,
      reason,
      rollbackFailures: [],
    })
  )
}

function isDockerGeneratedHostname(
  hostname: string | undefined,
  containerId: string
): boolean {
  return hostname === containerId.slice(0, 12) || hostname === containerId
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
import { Effect } from "effect"

import { RelaySystemUpdateError } from "./effect/errors.js"
