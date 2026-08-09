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
- Add only critical deterministic tests; prefer browser validation during
  development.
- This project uses Sentry.io for errors, traces, session replays, and more.
  `SENTRY_TRACES_SAMPLE_RATE` is set to 100% in local development. Review the
  `sentry-cli` skill when debugging.
- Avoid patching framework/library internals unless explicitly given permission.
- Use Sonner for transient feedback and shared tooltips for icon-only controls;
  do not add feedback UI that shifts the page layout.
- For user-visible or runtime work, use T3 Code's collaborative Preview against
  the OrbStack URL printed by `pnpm dev:docker`; never use a local IP for
  development or validation.

## Setup

Run once per clone from `main`:

```sh
vp install --frozen-lockfile
pnpm dev:setup
```

Name branches as `<type>/<task>`, with a short lowercase kebab-case task:

| Prefix      | Use for                                      |
| ----------- | -------------------------------------------- |
| `feat/`     | New capabilities                             |
| `fix/`      | Bugs and regressions                         |
| `refactor/` | Behavior-preserving code changes             |
| `ui/`       | Visual and interaction changes               |
| `perf/`     | Performance improvements                     |
| `infra/`    | Docker, deployment, and runtime tooling      |
| `docs/`     | Documentation only                           |
| `test/`     | Test-only changes                            |
| `chore/`    | Dependencies and repository maintenance      |
| `ci/`       | CI and release automation                    |

For example: `fix/panel-disconnect`. Do not use personal or agent-name
prefixes.

Use `<type>(<scope>)/<task>` for PR titles. Scopes are `hearth`, `bricks`,
`relay`, and `repo` for repo-wide changes. For work spanning multiple scopes,
list them comma-separated. For example: `fix(hearth)/panel-disconnect` or
`feat(hearth,relay)/server-events`.

## Pull request descriptions

Keep PR descriptions minimal and human:

```md
# Why
What it fixes or implements. Link an issue when one exists.

# Summary
Brief summary.

# Notes
Breaking changes, compatibility notes, migration steps, or anything else reviewers need to know.
```

Do not update the description during review for follow-up commits or fixes unless the overall PR changes.

For every change:

1. Switch to `main` and run `git pull --ff-only`.
2. Run `pnpm dev:docker:down` on `main` so its baseline stack is not left
   running.
3. In T3 Code, create a correctly named branch and worktree from `main`; never
   work directly on `main`.
4. In the new worktree, run `pnpm dev:docker`.
5. Immediately open the printed OrbStack URL in T3 Preview, leave it available
   for the user, and confirm Hearth loads before making any changes.
6. Develop and validate using that T3 Preview.
7. Commit, push, and open a ready-for-review PR. Never merge the PR yourself.

Do not run a development stack or Preview from `main`. Only active change
worktrees should have running Docker containers and open Previews.

Before deleting any worktree, run `pnpm dev:docker:destroy` inside it to remove
its isolated stack and data. Use `pnpm dev:docker:down` only to stop a stack
temporarily while retaining its data.

After a PR is merged:

1. Run `pnpm dev:docker:destroy` in the merged worktree.
2. Switch to `main` and run `git pull --ff-only`.
3. Delete the merged worktree and local branch.

# Reference Repos

This project takes inspiration on Pterodactyl's Panel (https://github.com/pterodactyl/panel) and wings (https://github.com/pterodactyl/wings). There's also a properly fully pterodactyl compliant alternative Hyrodactyl (formerly Pyrodactyl) that we reference (https://github.com/blueprintframework/hydrodactyl).

References Note: Do not assume that the decisions they make is the correct one. The vision for our project is to be a reimagined pterodactyl, not a pterodactyl clone. We can still learn from them as they have been battletested for millions of users.
