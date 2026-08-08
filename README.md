# Hearth

Kiln is a self-hosted platform for running game servers. Hearth is the web panel that manages them; Relay is the agent that runs on each host.

## Images

```text
ghcr.io/kiln-site/hearth:latest
ghcr.io/kiln-site/relay:latest
```

Nightly builds are published as `:latest-nightly`. Official Ember runtimes used by Bricks:

```text
ghcr.io/kiln-site/bricks-java:11
ghcr.io/kiln-site/bricks-java:17
ghcr.io/kiln-site/bricks-java:21
ghcr.io/kiln-site/bricks-java:25
ghcr.io/kiln-site/bricks-steamcmd:latest
```

## Configuration

Start from `.env.hearth.example`. These are the values worth setting for a first install:

```env
KILN_URL=https://hearth.example.com
DB_PASSWORD=
BETTER_AUTH_SECRETS=1:

KILN_RELAY_HOST=relay.example.com
KILN_RELAY_GAME_HOST=games.example.com
KILN_RELAY_GAME_PORT_RANGE=30000-39999
KILN_RELAY_BOOTSTRAP_TOKEN=
KILN_RELAY_PROXY=none
KILN_RELAY_ACME_EMAIL=

KILN_ENABLE_SIGNUPS=false
```

Generate secrets with `openssl rand -base64 48`. `BETTER_AUTH_SECRETS` is versioned (`1:<secret>`). For a colocated Compose stack, give Hearth and Relay the same bootstrap token so they can pair on first boot. Set `KILN_RELAY_PROXY` to `traefik` or `coolify` when an edge should terminate TLS; `none` leaves that to you.

Then:

```sh
docker compose up -d
```

## Development

Requires Node 20+, pnpm, Docker, and OrbStack.

```sh
vp install --frozen-lockfile
pnpm dev:setup
pnpm dev:docker
```

`dev:setup` only needs to run once per clone. Open the OrbStack URL printed by `dev:docker` to use the panel.

## Contact

Email contact@kiln.site.
