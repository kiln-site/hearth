# Hearth agents

Kiln is a fast, approachable, reliable self-hosted game-server platform. Keep
privileged Docker/filesystem work in Relay; Hearth is the control plane. Favor
simple operation and existing patterns over new abstractions.

Performance/Speed and UX is always the most important thing to keep in mind for everychange.

## Work

- Sync `main`, then use a focused branch. Preserve unrelated changes. 
- Use Vite+ (`vp`) and existing Effect patterns; never edit `.repos/effect`.
- Keep only critical deterministic tests. Prefer browser validation during
  development; use Sentry to find production regressions.

## Setup

Copy `.env.hearth.example` to `.env`, fill its required values, and set
`KILN_URL=https://hearth.hearth.orb.local`. Then run:

```sh
vp install --frozen-lockfile
pnpm dev:docker
```

This source-mounts both Hearth and Relay. Do not validate local work against
GHCR images.

## Validate

```sh
vp run -r typecheck
vp check
vp run -r test
vp run -r build
git diff --exit-code -- apps/web/src/routeTree.gen.ts
```

For user-visible or runtime work, use T3 Code's collaborative Preview tools
against `https://hearth.hearth.orb.local`; never substitute localhost or
`127.0.0.1`. Check the affected flows plus browser console/network failures.

Before a PR, run the full checks and T3 browser pass. Keep pushes minimal and
audit Greptile findings until it reports 5/5 ready to merge.

After merge: switch to `main`, pull with `--ff-only`, delete the merged local
branch, restart `pnpm dev:docker`, and verify the OrbStack URL in T3 Preview.

# Reference Repos

This project takes inspiration on Pterodactyl's Panel (https://github.com/pterodactyl/panel) and wings (https://github.com/pterodactyl/wings). There's also a properly fully pterodactyl compliant alternative Hyrodactyl (formerly Pyrodactyl) that we reference (https://github.com/blueprintframework/hydrodactyl). These should just be used to reference for ideas. 

