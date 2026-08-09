# Kiln CLI

Command-line access to Kiln and self-hosted Hearth instances. The CLI uses
readable tables, plain log and file output, and concise status messages.

## Install

Run without a global install:

```sh
npx kiln-cli --version
npx kiln-cli login
```

Or install it globally. The npm package is named `kiln-cli`; both installation
methods expose the `kiln` command.

```sh
npm install --global kiln-cli
kiln login
```

## Build locally

```sh
pnpm --filter kiln-cli build
./apps/cli/dist/kiln --version
```

Bun compiles the app into `dist/kiln`; Bun does not need to be installed on
the machine running that executable. Local macOS builds are ad-hoc signed with
the JavaScript runtime entitlements required by Bun.

## Authenticate

```sh
kiln login
kiln login https://hearth.example.com --name workstation --no-open
```

The first form targets `https://kiln.site`. The command opens a browser and
waits while you approve the sign-in. Self-hosted Hearth installations are
selected with the positional URL or `--url`. Named profiles are available
through `--profile`.

`KILN_URL` and `KILN_TOKEN` can bypass the saved profile in CI or scripts.
Saved profiles live under the platform config directory with owner-only file
permissions.

## Discover and operate

```sh
kiln servers list
kiln server power <relay-id>:<instance-id> restart
kiln server logs <relay-id>:<instance-id> --follow
kiln server console <relay-id>:<instance-id> "say deploy complete"
kiln files list <relay-id>:<instance-id> .
kiln files read <relay-id>:<instance-id> server.properties
kiln files write <relay-id>:<instance-id> server.properties ./server.properties
kiln files download <relay-id>:<instance-id> logs/latest.log ./latest.log
kiln files upload <relay-id>:<instance-id> ./plugins/example.jar plugins/example.jar
```

Uploads and downloads use the Relay SFTP endpoint and verify its advertised
SSH host-key fingerprint. Other file operations use the versioned CLI API.
Read-only credentials can discover servers, follow logs, and read files, but
cannot power servers, send console commands, modify files, or upload.

Run `kiln help` for the complete command reference.
