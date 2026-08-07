# Hearth

Kiln is a self-hosted platform for running game servers. Hearth is the web panel that manages them; Relay is the agent that runs on each host.

## Development

Requires Node 20+, pnpm, Docker, and OrbStack.

```sh
vp install --frozen-lockfile
pnpm dev:setup
pnpm dev:docker
```

`dev:setup` only needs to run once per clone. Open the OrbStack URL printed by `dev:docker` to use the panel.
