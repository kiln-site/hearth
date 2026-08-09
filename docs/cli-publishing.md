# CLI publishing

Every merge to `main` publishes `kiln-cli` with the same commit-derived nightly
version used by Hearth, such as `0.1.0-nightly.20260809.211537`. Stable app
promotions publish the matching stable CLI version. Both update npm's `latest`
tag so `npx kiln-cli` follows the currently published app release.

Publishing runs in `.github/workflows/publish-cli.yml` on a GitHub-hosted runner
using npm trusted publishing. It can also be manually dispatched with an
existing Kiln release tag to retry a release.

## Initial test package

npm requires a package to exist before its trusted publisher can be configured.
Publish the initial package under the isolated `test` tag:

```sh
release_line="$(jq -er '.releaseLine' release.json)"
version="${release_line}-test.$(date -u +%Y%m%d.%H%M%S)"
KILN_VERSION="$version" pnpm --filter kiln-cli build:npm
npm pack --dry-run ./apps/cli/dist/npm
npm publish ./apps/cli/dist/npm --access public --tag test
npx "kiln-cli@test" --version
```

Then configure the package's trusted publisher on npm:

- Provider: GitHub Actions
- Organization: `kiln-site`
- Repository: `hearth`
- Workflow filename: `publish-cli.yml`
- Allowed action: `npm publish`

Once OIDC publishing succeeds after merge, set the package's publishing access
to require 2FA and disallow tokens, then revoke any token that was only needed
for bootstrap.
