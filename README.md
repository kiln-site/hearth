# Kiln Hearth

Hearth is the TanStack Start control plane for [Kiln](./notes/VISION.md). Relay
is the small privileged service that discovers and operates labeled Minecraft
containers. The interface uses shadcn/ui, Tailwind CSS 4, and `@pierre/trees`.

## Docker setup

Copy [`.env.hearth.example`](./.env.hearth.example) to `.env` for the provided
all-in-one Compose stack, then replace at least these values:

```dotenv
DB_PASSWORD=replace-with-a-strong-database-password
KILN_URL=http://localhost:3000
KILN_RELAY_KEY=replace-with-the-output-of-openssl-rand-base64-48
BETTER_AUTH_SECRETS=1:replace-with-the-output-of-openssl-rand-base64-48
```

Pull and start the full stack:

```bash
docker compose up -d --wait
```

The Compose file prefers the published Hearth and Relay images. Add `--build`
to build them from the checked-out source instead.

Published multi-architecture images are available from GitHub Container
Registry:

```text
ghcr.io/kiln-site/hearth:latest
ghcr.io/kiln-site/relay:latest
ghcr.io/kiln-site/bricks-java:11
ghcr.io/kiln-site/bricks-java:17
ghcr.io/kiln-site/bricks-java:21
ghcr.io/kiln-site/bricks-java:25
ghcr.io/kiln-site/bricks-steamcmd:latest (amd64 only)
```

Ember sources, official recipes, their versioned schemas, and image publishing
live in the separate [kiln-site/bricks](https://github.com/kiln-site/bricks)
repository.

The stack contains Hearth, Relay, MySQL, and a disposable Valkey cache. On an
empty table set it registers the Compose Relay automatically. Hearth creates
the database schema and keeps all panel state in MySQL. Valkey only holds
short-lived Relay responses, so it does not need a persistent volume and an
outage falls back to the Relay. `BETTER_AUTH_SECRETS` is required and supplied
to the container from the environment; Hearth does not require a persistent
volume.

For a standalone Hearth image, use
[`.env.hearth.example`](./.env.hearth.example). `DB_HOST`, `DB_NAME`,
`DB_USERNAME`, `DB_PASSWORD`, `KILN_URL`, and stable `BETTER_AUTH_SECRETS` are
required in production; `DB_PORT` defaults to `3306`. `KILN_URL` is the
canonical browser-facing origin even when Cloudflare, Traefik, Caddy, or nginx
terminates TLS in front of Hearth. `BETTER_AUTH_URL` defaults to `KILN_URL` and
can be set explicitly when Better Auth needs a different externally visible
base URL.

Standalone Hearth deployments can optionally set `CACHE_HOST` to a Valkey or
Redis hostname. `CACHE_PORT` defaults to `6379`, `CACHE_DATABASE` defaults to
`0`, and `CACHE_TLS` defaults to `false`; `CACHE_USERNAME` and `CACHE_PASSWORD`
configure authentication when required. The bundled Compose stack supplies the
host and port automatically. Hearth caches only
brief Relay snapshots, file trees, Brick catalogs, and networking state;
authentication, authorization, credentials, files, and console data are never
cached. Hearth derives an installation-specific namespace from the database
connection so installations sharing a cache remain isolated.

`BETTER_AUTH_SECRETS` is an ordered, versioned keyring shared by Better Auth and
Hearth's encrypted Relay credentials. The first entry encrypts new data and
the remaining entries decrypt data from earlier rotations. Start with one key:

```dotenv
BETTER_AUTH_SECRETS=1:replace-with-output-of-openssl-rand-base64-48
```

To rotate it, prepend a new version and retain the old entry:

```dotenv
BETTER_AUTH_SECRETS=2:replace-with-new-openssl-rand-base64-48,1:replace-with-previous-openssl-rand-base64-48
```

Hearth rewrites a Relay credential with the current key after successfully
reading it. Better Auth manages key versions for its encrypted cookies and
records. Rotating the current key invalidates existing signed session cookies,
so users must sign in again; encrypted records remain readable through the
retained keys. Keep every version that is still referenced by stored data, and
back up the keyring outside MySQL.

`DB_TABLE_PREFIX` applies to every Kiln and Better Auth table. It must be a
lowercase, identifier-safe prefix ending in an underscore. It defaults to
`kiln_`. Changing the prefix selects a fresh table namespace; Kiln does not
rename an existing installation's tables automatically.

Hearth can register the first Relay without assuming that it runs on the same
node. Set the following on the Hearth container before its first database
migration:

```dotenv
KILN_RELAY_URL=https://relay.example.com
KILN_RELAY_NAME=Primary Relay
KILN_RELAY_KEY=replace-with-the-same-key-used-by-the-relay
```

`KILN_RELAY_URL` is optional and must be an `http` or `https` origin without a
path. When the prefixed Relay table is empty, Kiln stores that endpoint and an
encrypted copy of `KILN_RELAY_KEY` as the primary Relay. Once a Relay exists,
the database is authoritative: restarting with changed environment values does
not replace settings managed through the UI.

On an empty database, opening `KILN_URL` starts the first-boot administrator
flow. Alternatively, these optional values create a verified administrator on
the first request:

```dotenv
KILN_SUPER_USER_EMAIL=admin@example.com
KILN_SUPER_USER_PASSWORD=a-long-unique-password
```

Public signup is disabled by default. Set `KILN_ENABLE_SIGNUPS=true` to expose
account creation. Invitations remain usable while public signup is disabled.

`KILN_ENVIRONMENT` defaults to `prod`, including when it is absent. A trusted
local installation can set `KILN_ENVIRONMENT=dev` to expose a non-persistent
**Skip login for development** action on both the login and first-boot setup
screens. Docker deployment environment changes require recreating the Hearth
container. The bypass is ignored whenever the environment returns to `prod`.

Email delivery is optional. Set both values to deliver verification, recovery,
and invitation messages through Resend:

```dotenv
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=Kiln <auth@example.com>
```

If either value is absent, six-digit authentication codes and invitation links
are written to `docker compose logs hearth`. A mail-less first boot can skip
verification for the initial administrator.

`BETTER_AUTH_URL` is Better Auth's explicit base URL and defaults to
`KILN_URL`; that origin is always trusted. Kiln also trusts
`http://localhost:3000`, `https://hearth.kiln.site`, and the local OrbStack
origin `https://hearth.hearth.orb.local`. Additional trusted origins can be
supplied as a comma-separated `BETTER_AUTH_TRUSTED_ORIGINS`.

The production images are defined in [apps/web/Dockerfile](./apps/web/Dockerfile)
and [apps/relay/Dockerfile](./apps/relay/Dockerfile). Relay requires
`KILN_RELAY_KEY`; `KILN_RELAY_PORT` is optional and defaults to `4100`. It also
requires the Docker socket plus a persistent `/data` volume.
`KILN_BRICKS_CATALOG_URL` selects the official or operator-maintained catalog.

Relay serves an unauthenticated `GET /health` liveness check that does not
query Docker or require an Ember connection. The Relay image uses it for its
built-in Docker healthcheck. All management routes remain protected by
`KILN_RELAY_KEY`.

## Authentication and access

Kiln uses email and password identities—there are no usernames. Verification
and password recovery use expiring, single-use Better Auth OTPs. Unverified
accounts expire after 24 hours. Authenticator-app TOTP, encrypted recovery
codes, trusted devices, and WebAuthn passkeys are managed from **Account
security**.

Every control-plane route, server function, and live console stream requires a
session. The development bypass is available only when the explicit
`KILN_ENVIRONMENT=dev` switch is present; optimized Docker builds continue to
run with `NODE_ENV=production`.

Platform administrators can configure Relay connections and manage users.
Scoped Relay and instance roles are:

- **Owner** — every permission, including owner assignment and Relay removal.
- **Admin** — access management, Relay configuration, and all instance actions.
- **Operator** — commands, file writes, power actions, and log sharing.
- **Viewer** — read-only info, console, files, and log sharing.

Invitations are bound to one normalized email address, expire after seven days,
and can be revoked before acceptance.

## Bricks and Relay lifecycle

Hearth's **Bricks** screen asks a selected Relay to create the server from a
`kiln.brick/v1` YAML recipe. The official external catalog currently includes
Paper, Folia, Fabric, Velocity, and Palworld; administrators can load any trusted
HTTPS recipe directly. Recipes declare the OCI image, per-deployment variables,
environment, resources, storage mount, ports, architecture constraints, and
routing mode. New v1 Bricks require no Relay update.

Relay creates one isolated container and one persistent data directory for
every Brick. Containers use a read-only root filesystem, a writable `/server`
mount, a bounded ephemeral `/tmp`, dropped Linux capabilities,
`no-new-privileges`, PID and memory limits, and the private `kiln-minecraft`
bridge. The game server remains the only substantial process in the container.
Relay applies these labels itself:

```yaml
labels:
  kiln.relay.managed: "true"
  kiln.relay.owned: "true"
  kiln.server.id: "40-character-hexadecimal-id"
  kiln.brick.id: "paper"
  kiln.brick.format: "kiln.brick/v1"
  kiln.brick.source: "https://example.com/paper.yml"
```

Relay uses the first eight ID characters in Hearth URLs and rejects short-ID
collisions. It directly owns start, stop, restart, deletion, interactive
console streaming, bounded file access, and read-only decompression for
Minecraft `.log.gz` archives. Deletion sends a graceful stop before removing
the container; persisted server data is removed only when explicitly requested.

The Tailnet routing controls let Relay own a CoreDNS wildcard zone, PicoLimbo,
the private Minecraft network, and a single Velocity entrypoint. Point
Tailscale split DNS at the node, then names such as `1.21.11.paper.test` resolve
to its Tailnet address. Port `25565` is omitted from displayed connection names.

Official Java Embers use Eclipse Temurin and `jlink`; the generic amd64
SteamCMD Ember installs the app and executable declared by its recipe. Custom
recipes may reference any OCI image. Relay still enforces its storage root,
read-only root filesystem, dropped capabilities, `no-new-privileges`, PID and
memory limits, and isolated network, and never exposes host-path or privileged
container controls through the recipe format.

## Development

For the complete Docker-backed development stack with Vite hot module
replacement, run:

```bash
pnpm dev:docker
```

This uses `compose.dev.yaml` to bind-mount the repository into development Node
containers for Hearth and Relay while keeping their Linux `node_modules` and
pnpm stores in named volumes. The production Compose path and images remain
unchanged. Both `http://localhost:3000` and
`https://hearth.hearth.orb.local` reach the HMR server. Stop the development
stack with `pnpm dev:docker:down`.

For a host-run development process instead, install dependencies, start MySQL,
and apply the development schema:

```bash
pnpm install
pnpm db:up
pnpm db:migrate
```

Then run Relay and Hearth:

```bash
pnpm --filter relay dev
pnpm --filter web dev
```

The root `.env` is read automatically. For development-only overrides, see
[`.env.hearth.example`](./.env.hearth.example) and
[`.env.relay.example`](./.env.relay.example).

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm build
```

## Structure

```text
apps/relay/          Relay node API and Docker/filesystem drivers
apps/web/            TanStack Start control-plane application
packages/contracts/  Shared Zod wire contracts
packages/ui/         Shared shadcn/ui design system and theme
notes/               Project planning and architecture notes
```
