# CLI publishing

Every merge to `main` publishes `kiln-cli` with the same commit-derived nightly
version used by Hearth, such as `0.1.0-nightly.20260809.211537`. Stable app
promotions publish the matching stable CLI version. Both update npm's `latest`
tag so `npx kiln-cli` follows the currently published app release.

Publishing runs in `.github/workflows/publish-cli.yml` on a GitHub-hosted runner
using npm trusted publishing. It can also be manually dispatched with an
existing Kiln release tag to retry a release.

## One-time bootstrap

npm requires a package to exist before its trusted publisher can be configured.
After this change is merged and its nightly release tag exists:

```sh
git switch main
git pull --ff-only
version="$(git tag --points-at HEAD \
  | sed -nE 's/^v(0\.[0-9]+\.[0-9]+-nightly\.[0-9]{8}\.[0-9]{6})$/\1/p' \
  | head -n 1)"
test -n "$version"
KILN_VERSION="$version" pnpm --filter kiln-cli build:npm
npm pack --dry-run ./apps/cli/dist/npm
npm publish ./apps/cli/dist/npm --access public --tag latest
```

Then configure the package's trusted publisher on npm:

- Provider: GitHub Actions
- Organization: `kiln-site`
- Repository: `hearth`
- Workflow filename: `publish-cli.yml`
- Allowed action: `npm publish`

Re-run the failed **Publish CLI** workflow if it raced the bootstrap. Once OIDC
publishing succeeds, set the package's publishing access to require 2FA and
disallow tokens, then revoke any token that was only needed for bootstrap.
