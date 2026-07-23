# Hearth agents

Kiln is a fast, approachable, reliable self-hosted server platform panel/orchestrator. It's catered towards game servers (focus on Minecraft), but should be agnostic to other servers.
Favor simple operation and existing patterns over new abstractions,

Performance/Speed and UX is always the most important thing to keep in mind for every change you do. Make sure any UI change doesn't cause react to re-render/paint other components. If needed react-scan and react-audit can be used to verify.

<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `pnpm dlx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->


## Work

- Use Vite+ (`vp`) and existing Effect patterns; never edit `.repos/effect`.
- Keep only critical deterministic tests, and been hesitant or creating new tests. Prefer browser validation during development
- This project uses Sentry.io for error/traces/session replays and more. SENTRY_TRACES_SAMPLE_RATE is set to 100% in local development. Review the sentry-cli skill when debugging
- Avoid patching framework/library internals unless explicitly given permission.

For user-visible or runtime work, use T3 Code's collaborative Preview tools
against `https://hearth.hearth.orb.local`; Avoid using local IP (ie. 127.0...) for dev/testing.

When preparing a PR you can commit breakpoints/checkpoints but limit pushes. We have reviewers auto audit PRs that will run on every push. When you do push, you should wait for their audits and address them. They might not always be perfect, use your jugdgemnt. Never merge the PR as the human will be the final reviewer.

After a successful merge: leave the existing `pnpm dev:docker` session running, switch to
`main`, pull with `--ff-only`, delete the merged local branch, run
`pnpm dev:docker:refresh`, and verify the OrbStack URL in T3 Preview. Reserve
`pnpm dev:docker:down` for changes that require rebuilding the Compose network or volumes.

## Setup

Copy `.env.hearth.example` to `.env`, fill its required values, and set
`KILN_URL=https://hearth.hearth.orb.local`. Then run:

```sh
vp install --frozen-lockfile
pnpm dev:docker
```

# Reference Repos

This project takes inspiration on Pterodactyl's Panel (https://github.com/pterodactyl/panel) and wings (https://github.com/pterodactyl/wings). There's also a properly fully pterodactyl compliant alternative Hyrodactyl (formerly Pyrodactyl) that we reference (https://github.com/blueprintframework/hydrodactyl). 

References Note: Do not assume that the decisions they make is the correct one. The vision for our project is to be a reimagined pterodactyl, not a pterodactyl clone. We can still learn from them as they have been battletested for millions of users.
