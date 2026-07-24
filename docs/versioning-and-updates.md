# Versioning and updates

Kiln publishes Hearth and Relay together from the public
[`kiln-site/hearth`](https://github.com/kiln-site/hearth) repository. GitHub
Releases is the release index and GHCR is the only image source.

## Versions and channels

- The active release line lives in `release.json` and always uses `0.x.x`.
- Every successful push to `main` reserves the next
  `0.x.x-nightly.<increment>` version.
- The first release line is `0.1.0`; its first nightly is
  `0.1.0-nightly.1`.
- Nightlies are GitHub prereleases. A stable release promotes a selected
  nightly without rebuilding its images.
- Stable promotion closes that release line. The workflow advances
  `release.json` to the operator-selected next `0.x.x` line before more
  nightlies are published.

Published image tags:

| Tag               | Meaning                   |
| ----------------- | ------------------------- |
| `0.1.0-nightly.7` | Exact nightly             |
| `latest-nightly`  | Newest nightly            |
| `0.1.0`           | Exact stable release      |
| `latest`          | Newest stable release     |
| `sha-<commit>`    | Source-build traceability |

Before the first stable release, `latest` temporarily follows the newest
nightly so a new installation has a usable default. Stable promotion takes
over that tag permanently.

Each GitHub release includes `release-manifest.json`, which binds the release
version and source commit to immutable Hearth and Relay image digests. Runtime
release discovery and image pulls are anonymous. CI verifies that both GHCR
images are publicly readable before it publishes a GitHub release.

## Update eligibility

The Updates page is available to platform administrators at `/infra/updates`.
The normal Servers page is at `/infra/servers`; `/servers` remains a redirect.

One-click updates are enabled only when all of these are true:

1. The target is an official Hearth or Relay image.
2. Its configured image is `:latest` or `:latest-nightly`.
3. A paired Relay can access the target's Docker daemon.
4. The selected release has a valid public release manifest.

Exact version tags, digest pins, locally built images, and custom registries
remain externally managed. Kiln explains why their update button is disabled.
To persist a downgrade, pin the older version in the external Compose or
Coolify configuration; an in-panel downgrade alone can be replaced by the next
external deployment.

Hearth itself does not receive the Docker socket. A co-located Relay performs
its update. Relay updates use the Relay's own socket.

## Container replacement

Relay pulls the selected immutable digest and verifies its image labels. It
then launches a short-lived updater from the selected Relay digest. The helper:

1. Inspects the current container.
2. Stops it gracefully and renames it as a rollback copy.
3. Creates the replacement with the existing environment, mounts, labels,
   ports, restart policy, and Docker networks.
4. Waits for the replacement health check.
5. Removes the rollback copy on success, or restores it on failure.

Update operation state lives in the Relay data volume, so a Relay can report
the outcome after replacing itself. Hearth polls through disconnects and shows
that it is waiting for reconnection. Hearth's existing Relay connection state
continues to mark instances offline while Hearth is unavailable.

Coolify remains free to manage the same containers. Kiln does not call the
Coolify API and does not modify its project configuration. A later Coolify
deployment is authoritative and may reapply the tag configured there.
Pushes to `main` publish a nightly but no longer trigger provider deployment
webhooks. Existing installations that relied on push-to-deploy must update
through `/infra/updates` or redeploy through their provider.

## Relay provisioning policy

Relays allow new server provisioning by default. Set
`KILN_RELAY_ALLOW_PROVISIONING=false` only on a Relay that should provide
host-level update support without accepting new servers. Hearth omits that
Relay from the add-server selector, and Relay also rejects direct create
requests.

## Release operations

Nightly releases are automatic through `nightly-release.yml`. To publish a
stable release, run `stable-release.yml` and supply the nightly version without
the leading `v`, for example `0.1.0-nightly.18`, plus the next release line,
for example `0.2.0`.

Stable promotion reuses the nightly's exact image digests, publishes `0.1.0`
and `latest`, creates tag `v0.1.0` at the nightly commit, and publishes a normal
GitHub release. It then commits the next release line to `main`, which starts
the next nightly series. The workflow is safe to rerun for the same nightly and
next release line.

When a release changes the Relay control protocol, update Hearth first. The
transitional Hearth release must continue speaking the previous Relay protocol
long enough to update the fleet; Relay updates remain blocked until the running
Hearth recognizes the manifest protocol.
