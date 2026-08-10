---
name: kiln-cli
description: Use the Kiln CLI to authenticate, select profiles, discover Hearth servers, inspect logs, send console or power commands, and list, read, write, upload, or download server files. Use when a user asks to run, test, or troubleshoot `kiln` commands or mentions Kiln CLI server references, remote paths, or file transfers.
version: "1.0.0"
requires:
  bins: ["kiln"]
  auth: true
---

# Kiln CLI

Use the locally installed `kiln` command to operate Kiln and self-hosted Hearth
servers. Run requested commands when the binary and authentication are already
available; do not stop at providing command examples.

## Safety and credentials

- Treat power actions, console commands, file writes, and uploads as remote
  mutations. Verify an ambiguous target or destination before running them. An
  explicit user request naming the server, action, and path is sufficient
  authorization.
- Never print, copy, or commit a Kiln token. Prefer saved profiles. Use
  `KILN_TOKEN` or `--token` only when the user deliberately provides an
  ephemeral credential, and keep it out of reported command output.
- Do not inspect the saved config file unless authentication or profile
  resolution itself is being debugged. If inspection is necessary, redact the
  complete token value.
- Do not silently switch a command between production Kiln and a self-hosted
  Hearth URL. Confirm the active target with `kiln whoami`.

## Preflight

Start with the smallest useful checks:

```sh
command -v kiln
kiln --version
kiln whoami
```

If the binary is missing, report that before suggesting installation. If
authentication is missing, use the appropriate login flow:

```sh
kiln login
kiln login https://hearth.example.com --profile staging --name workstation
```

`kiln login` targets `https://kiln.site` by default and normally opens a
browser. Add `--no-open` when the environment cannot launch one. Do not start a
new login when an authenticated profile already targets the requested Hearth.

Use `--profile <name>` on any command to select a saved profile. `KILN_URL`,
`KILN_TOKEN`, and `KILN_CONFIG` support isolated automation, but prefer the
user's existing authenticated profile for interactive work.

## Resolve a server

Discover targets instead of guessing identifiers:

```sh
kiln servers list
```

Copy the entire value from the `ID` column. Every server command requires this
combined reference:

```text
<relay-id>:<instance-id>
```

The relay ID and instance ID are both required. Do not pass the instance ID by
itself, a short ID, or the display name.

## Remote path rules

Treat all remote paths as relative to the selected server root.

- Use `bukkit.yml`, `logs/latest.log`, or `plugins/example.jar`.
- Do not prefix a path with `/`.
- Do not include the host/container prefix `/data`; the CLI already scopes the
  operation to the server root.
- Do not use `.` or `..` as a file path. `.` is valid only as the directory
  argument to `files list`.

For example, read the root-level Bukkit configuration with:

```sh
kiln files read <server> bukkit.yml
```

## Files

List a directory before acting when the requested path is uncertain:

```sh
kiln files list <server> .
kiln files list <server> plugins
```

Read text to stdout:

```sh
kiln files read <server> bukkit.yml
```

Use `files read` for text inspection. Use `files download` for binary files or
when preserving exact bytes matters.

Write text from a local file or standard input:

```sh
kiln files write <server> server.properties ./server.properties
kiln files write <server> whitelist.json -
```

Text writes use the CLI API and accept at most 16 MiB from standard input.

Download one remote file over SFTP:

```sh
kiln files download <server> plugins/example.jar ./example.jar
```

If the local destination is omitted, the CLI uses the remote basename in the
current directory.

Upload one regular local file over SFTP:

```sh
kiln files upload <server> ./example.jar plugins/example.jar
```

If the remote destination is omitted, the CLI uses the local basename in the
server root. The remote parent directory must already exist. Uploads and
downloads verify the Relay's advertised SSH host-key fingerprint.

After a mutation, verify with the least expensive read operation, such as
`files list` or `files read`. Do not print binary content for verification.

## Logs, console, and power

Read recent logs or follow the stream:

```sh
kiln server logs <server> --limit 200
kiln server logs <server> --limit 200 --follow
```

Send a one-line console command:

```sh
kiln server console <server> "say deploy complete"
```

If the command argument is omitted, the CLI reads it from standard input.

Use only the supported power actions:

```sh
kiln server power <server> start
kiln server power <server> stop
kiln server power <server> restart
kiln server power <server> kill
```

Treat `kill` as destructive and reserve it for an explicit request or a server
that cannot stop normally.

## Diagnose failures

Preserve the exact failing command, CLI version, active Hearth URL, server
reference, and error message. Never include the token.

Use this sequence to isolate the layer:

1. Run `kiln whoami` to verify authentication, profile, access mode, and URL.
2. Run `kiln servers list` to confirm the full server reference is still
   available.
3. Run `kiln files list <server> .` to test the normal CLI API and Relay.
4. For a text path, run `kiln files read <server> <path>` to test file reads.
5. Run the requested upload or download to test SFTP bootstrap and transport.

Interpret the result narrowly:

- If list and read work but upload and download fail, focus on the SFTP
  bootstrap response, Relay SFTP reachability, authentication, or host-key
  verification. General file reads do not use the same transfer path.
- If all file operations fail, check the profile URL, credential access,
  server reference, Relay availability, and root-relative path first.
- If a root file is not found, retry the path without `/` or `/data/`.
- If an upload reports a local-file error, confirm the source exists and is one
  regular file. Directory uploads are not supported.
- If Hearth returns HTTP 500, treat it as a server-side defect. Correlate the
  request with application logs, Sentry, or traces when available; do not add
  proxy or routing workarounds without evidence that routing is the cause.

When reporting completion, state the operation, server, remote path, local path
when applicable, and observed result. Call out partial success and roadblocks
explicitly.
