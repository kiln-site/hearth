# Hearth Vision

## Summary

Kiln is a self-hosted platform for creating disposable, reproducible game-server
environments. Its initial focus is testing Minecraft plugins and mods across
multiple server implementations and protocol versions, but its core concepts
must remain useful for other dedicated game servers in the future.

Hearth is Kiln's control plane. It provides the web interface, product API,
authentication, durable state, and orchestration decisions. Relay is the
node-side agent that performs privileged operations such as managing containers,
files, volumes, consoles, and downloads.

The central product vocabulary is:

- **Kiln**: the umbrella brand and ecosystem.
- **Hearth**: the full-stack control plane and primary repository.
- **Relay**: the agent installed on every machine that runs game servers.
- **Brick**: a reusable declaration describing how to install and run a
  workload.
- **Instance**: a deployed game server created from a Brick.

A useful description of the system is:

> Connect a Relay to your Hearth, then deploy Instances from Bricks.

## Product Goals

Hearth should make it easy for developers to:

- Create clean game-server environments without manually sourcing or installing
  server binaries.
- Reproduce the same environment locally, on a workstation, or on an Ubuntu
  VPS.
- Test a project across server implementations and protocol versions.
- Start stopped servers automatically when a matching client connects.
- Manage configuration, mods, plugins, worlds, logs, and console access from a
  focused web interface.
- Keep infrastructure private through options such as Tailscale without making
  a specific networking provider mandatory.
- Add support for another game without redesigning the control plane.

The initial product should remain a focused developer tool. Public hosting,
billing, Kubernetes support, and generalized infrastructure management are not
MVP requirements.

## System Boundaries

```text
Browser
   |
   v
Hearth Web -- TanStack Start
   |-- React interface
   |-- authentication and authorization
   |-- PostgreSQL and durable operations
   |-- desired state and scheduling decisions
   `-- Relay-facing API
             |
             v
          Relay
          |-- Docker
          |-- persistent volumes and files
          |-- artifact downloads
          |-- console and logs
          `-- health and resource reporting
```

Hearth is a full-stack application, not a frontend that depends on a separate
general-purpose API. TanStack Start server functions provide the internal,
type-safe boundary between the React interface and control-plane logic. Explicit
server routes provide the versioned API used by Relay and future external
clients.

Relay is a separate process and deployment boundary, even when it lives in the
same monorepo and runs on the same host. The public Hearth process must never
receive direct access to the Docker socket. Relay is the only component allowed
to perform privileged node operations.

On a single-node installation, Hearth, PostgreSQL, and Relay can run together
through Docker Compose. Additional nodes install only Relay.

## Repository Direction

The initial monorepo should use the following shape:

```text
hearth/
|-- apps/
|   |-- web/                 # Full-stack TanStack Start control plane
|   `-- relay/               # TypeScript node agent
|-- packages/
|   |-- contracts/           # Zod commands, events, and API schemas
|   |-- database/            # Drizzle schema and migrations
|   |-- bricks/              # Brick schema, parsing, and providers
|   |-- orchestration/       # Instance lifecycle state machine
|   `-- ui/                  # React design system
|-- docs/
|   `-- decisions/           # Architecture decision records
|-- compose.yaml             # Local and single-node deployment
|-- package.json
`-- pnpm-workspace.yaml
```

Hearth and Relay should initially be implemented in TypeScript so they can
share schemas and domain concepts directly. All data crossing a process or
network boundary must still be validated at runtime. Zod schemas are the source
of truth for those contracts, allowing clients for other languages to be
generated later if Relay is ever rewritten.

The expected container images are:

```text
ghcr.io/kiln-site/hearth
ghcr.io/kiln-site/relay
```

## Desired and Observed State

Starting an Instance must not require a browser request to remain open while a
game server downloads files or boots. Hearth records intent and Relay performs
the work asynchronously.

The basic flow is:

1. A user requests that an Instance run.
2. Hearth records the desired state and creates a durable operation.
3. Relay receives and acknowledges a command.
4. Relay provisions files and starts the container.
5. Relay reports progress and observed state.
6. Hearth persists those events and updates connected clients.

Desired state is intentionally small:

```text
stopped | running
```

Observed state communicates what is actually happening:

```text
offline | provisioning | starting | running | stopping | failed
```

This separation allows Hearth to recover safely from panel restarts, Relay
disconnects, interrupted downloads, and failed containers.

## Bricks and Instance Provisioning

Server directories and JARs should not be committed as prerequisites for a
Hearth deployment. An Instance owns a persistent data volume, and its Brick
describes how that volume is provisioned and how the workload runs.

A Brick should be independent of a particular container whenever practical. It
can declare:

- Artifact providers and versions.
- Runtime image and command.
- Environment variables and user-configurable settings.
- Ports and networking requirements.
- Files and configuration templates.
- Health checks and readiness behavior.
- Upgrade and migration behavior.

McJars will be the first Minecraft server artifact provider. Later providers
can include Modrinth, direct downloads, and SteamCMD. Supporting a new game
should primarily mean adding providers, runner images, and Bricks rather than
changing Hearth's core lifecycle.

## Initial Minecraft Scope

The first useful release should support:

- Paper, Folia, Fabric, and Velocity.
- Multiple Minecraft protocol versions.
- FabricProxy-Lite and Velocity modern forwarding.
- Generic and version-specific hostnames.
- Protocol-aware backend selection.
- Automatic cold starts through Velocity.
- PicoLimbo while a selected backend becomes ready.
- Optional Tailscale connectivity and split DNS.
- Persistent server files with generated artifacts kept out of Git.

The existing local Minecraft Compose environment is the behavioral prototype
for these features. Its wake controller should evolve into Relay, while its
hand-maintained server directories should be replaced by Brick-driven
provisioning.

## MVP Capabilities

The first self-hosted release should include:

- One Hearth installation with one or more Relay nodes.
- Initial administrator authentication.
- Relay enrollment, identity, heartbeat, and capacity reporting.
- Nodes, Bricks, Instances, and durable Operations in the web interface.
- Instance create, start, stop, restart, and delete operations.
- A real Docker and filesystem execution driver.
- Live logs and console input.
- Basic CPU, memory, storage, and health information.
- File browsing, editing, and uploads.
- Plugin and mod uploads.
- McJars-backed Minecraft provisioning.
- Persistent Instance data and basic backups.
- A Docker Compose deployment for a single-node installation.

## Delivery Plan

### Phase 1: Foundation

- Establish the pnpm monorepo and shared tooling.
- Scaffold the TanStack Start web application.
- Scaffold Relay as a separate TypeScript service.
- Add PostgreSQL, Drizzle, Zod, testing, CI, and local Compose services.
- Establish the visual shell and initial design system.

### Phase 2: Domain and Persistence

- Define the Brick schema.
- Define desired and observed Instance states.
- Model users, nodes, Bricks, Instances, commands, events, and operations.
- Implement durable lifecycle transitions and an audit trail.

### Phase 3: Control Plane

- Implement authentication and authorization.
- Build the Nodes, Bricks, Instances, and Operations workflows.
- Expose internal server functions and a versioned Relay API.
- Provide a simulated Relay so the interface can be developed independently.

### Phase 4: Relay

- Implement enrollment and machine identity.
- Add heartbeat, capacity, command delivery, and event reporting.
- Add the Docker and filesystem drivers.
- Implement container lifecycle, volumes, logs, console, and health checks.

### Phase 5: Minecraft Provisioning

- Add the McJars provider.
- Define official Paper, Folia, Fabric, and Velocity Bricks.
- Generate forwarding and backend configuration.
- Reproduce the current test matrix without preexisting server directories.

### Phase 6: Developer Workflow

- Add the file manager, editor, uploads, mods, plugins, and backups.
- Add configuration forms where structured editing is valuable.
- Surface operation progress, failure causes, logs, and recovery actions.

### Phase 7: Networking and Wake Routing

- Integrate protocol-aware Velocity routing and automatic Instance starts.
- Keep clients in PicoLimbo until their selected backend is ready.
- Add optional Tailscale DNS and private-node connectivity.
- Validate the architecture across multiple Relay nodes.

### Phase 8: First Release

- Harden secrets, node enrollment, transport security, and permissions.
- Add installation, upgrades, recovery, backups, and observability.
- Publish Hearth and Relay images and a documented self-hosted deployment.

## Guiding Principles

- Optimize first for game-project developers, not generalized hosting.
- Keep Minecraft as the first implementation, not a permanent architectural
  constraint.
- Prefer explicit, durable state over synchronous infrastructure requests.
- Keep privileged node access out of the public control plane.
- Use normal product language after the core Kiln, Hearth, Relay, and Brick
  vocabulary.
- Make the simplest single-node installation useful without preventing a
  secure multi-node future.
