# Making changes

1. On `main`, run `git pull --ff-only`.
2. Run `pnpm dev:setup` once per clone.
3. In T3 Code, create a new branch and worktree from `main`.
4. In the worktree, run `pnpm dev:docker`.
5. Open the Hearth URL printed by the command.
6. Before deleting the worktree, run `pnpm dev:docker:destroy`.
