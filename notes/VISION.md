# Hearth Vision

## What Kiln Is

Kiln is an open-source, self-hosted platform for creating and managing
game-server environments. It is a modern reimagining of Pterodactyl's panel and
Wings model, built around a simpler setup and a faster, more focused experience.

Minecraft is the initial focus, but Kiln's core concepts should support other
dedicated game servers without requiring the platform to be redesigned.

> Connect a Relay, choose a Brick, and launch an Instance.

## Vocabulary

- **Kiln**: the umbrella product and ecosystem.
- **Hearth**: the web control plane that manages users, configuration, and
  orchestration.
- **Relay**: the node agent that performs privileged Docker and filesystem work
  and reports state back to Hearth.
- **Ember**: the minimal container runtime in which an Instance runs.
- **Brick**: a reusable recipe that tells Relay which Ember to use and how to
  provision and configure a workload.
- **Instance**: a deployed workload created from a Brick and managed by Relay.

## Priorities

- **Performance**: keep the panel responsive and Relay interactions fast.
- **End-user experience**: make powerful server management feel approachable.
- **Simple setup and operation**: require as little infrastructure knowledge and
  configuration as possible.
- **Stability and reliability**: recover cleanly and behave predictably.
- **Safe self-hosting**: keep privileged node access on Relay, not the public
  Hearth control plane.
