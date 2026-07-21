# Hearth agents

Kiln is a fast, approachable, reliable self-hosted game-server platform. Keep
privileged Docker/filesystem work in Relay; Hearth is the control plane. Favor
simple operation and existing patterns over new abstractions.

Performance/Speed and UX is always the most important thing to keep in mind for every change you do. Make sure any UI change doesn't cause react to re-render/paint other components. You can use react-scan and react-audit to verify. Avoid patching framework/library internals unless explicitly given permission.

## Work

- Use Vite+ (`vp`) and existing Effect patterns; never edit `.repos/effect`.
- Keep only critical deterministic tests, and been hesitant o creating new tests. Prefer browser validation during development
- This project uses Sentry.io for error/traces/session replays and more. SENTRY_TRACES_SAMPLE_RATE is set to 100% in local development. Review the sentry-cli skill when debugging

For user-visible or runtime work, use T3 Code's collaborative Preview tools
against `https://hearth.hearth.orb.local`;

When preparing a PR you can commit breakpoints/checkpoints but limit pushes. We have reviewers auto audit PRs that will run on every push. When you do push, you should wait for their audits and address them. They might not always be perfect, use your jugdgemnt. Never merge the PR as the human will be the final reviewer.

After a successful merge: switch to `main`, pull with `--ff-only`, delete the merged local
branch, restart `pnpm dev:docker`, and verify the OrbStack URL in T3 Preview.

## Setup

Copy `.env.hearth.example` to `.env`, fill its required values, and set
`KILN_URL=https://hearth.hearth.orb.local`. Then run:

```sh
vp install --frozen-lockfile
pnpm dev:docker
```

# Reference Repos

This project takes inspiration on Pterodactyl's Panel (https://github.com/pterodactyl/panel) and wings (https://github.com/pterodactyl/wings). There's also a properly fully pterodactyl compliant alternative Hyrodactyl (formerly Pyrodactyl) that we reference (https://github.com/blueprintframework/hydrodactyl). 

Note: These should just be used to reference ideas and implementation. Do not assume that the decisions they make is the correct one. The vision for our project is to be a pterodactyl reimagined, not a pterodactyl clone. That being said we can definitely learn from them as they have been battle tested by millions of users.
