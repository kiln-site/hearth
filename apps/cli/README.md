# Kiln CLI

Agent-first command-line access to Hearth. Output is JSON by default, log
streams are NDJSON, and failures use a stable `error.code`, `message`, and
`retryable` shape.

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
kiln login https://hearth.example.com --name build-agent --no-open
```

The first form targets `https://kiln.site`. The command prints an
`authorization_required` record and waits while the user approves the link in
their browser. Self-hosted Hearth installations are selected with the
positional URL or `--url`. Named profiles are available through `--profile`.

For ephemeral agents, `KILN_URL` and `KILN_TOKEN` bypass the saved profile.
Saved profiles live under the platform config directory with owner-only file
permissions.

## Discover and operate

```sh
kiln capabilities
kiln servers list
kiln server power <relay-id>:<instance-id> restart
kiln server logs <relay-id>:<instance-id> --follow
kiln server console <relay-id>:<instance-id> "say deploy complete"
kiln files list <relay-id>:<instance-id> .
kiln files read <relay-id>:<instance-id> server.properties --raw
kiln files write <relay-id>:<instance-id> server.properties ./server.properties
kiln files download <relay-id>:<instance-id> logs/latest.log ./latest.log
kiln files upload <relay-id>:<instance-id> ./plugins/example.jar plugins/example.jar
```

Uploads and downloads use the Relay SFTP endpoint and verify its advertised
SSH host-key fingerprint. Other file operations use the versioned CLI API.
Read-only credentials can discover servers, follow logs, and read files, but
cannot power servers, send console commands, modify files, or upload.

Use `--output human` for interactive output. Run `kiln help` for the complete
machine-readable command manifest.
