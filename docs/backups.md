# Backups

This document defines Kiln's backup architecture and the delivery order for the
first implementation. Scheduling is intentionally outside the first release;
manual tasks use the same durable task model that schedules can enqueue later.

## Goals

- Back up game servers, managed databases, and the Kiln installation.
- Store backups on the Relay or in an S3-compatible bucket.
- Allow a platform S3 destination or a user-owned S3 destination to be chosen
  per resource.
- Let Relay finish work while Hearth is disconnected and reconcile the result
  after reconnecting.
- Serialize backup and restore work per Relay to bound disk, CPU, and network
  pressure.
- Enforce per-resource quantity and logical-size limits set by the resource
  owner, with optional stricter platform-admin caps.
- Restore with one clear action and optionally create a safety backup first.
- Produce short-lived download URLs for both local and S3 artifacts.
- Take a portable full backup before destructive resource deletion.

## Ownership model

Hearth owns intent, policy, authorization, and the user-visible catalog. Relay
owns execution, temporary files, local artifacts, and the durable task journal.
The managed server or database process never owns the backup job.

1. Hearth authorizes a request, evaluates the effective limits, creates the
   catalog record, and submits an idempotent task ID.
2. Relay persists the complete task before acknowledging it.
3. One Relay worker claims the oldest queued task and runs it independently of
   the control socket.
4. Relay atomically persists progress and the terminal result. Events are an
   optimization, not the source of truth.
5. Hearth consumes events while connected and lists tasks changed since its
   last cursor whenever a Relay reconnects.

Submitting an existing task ID returns its current task rather than starting a
second operation. A Relay restart changes an interrupted `running` task back to
`queued` when it is safe to retry. Relay-local creates are immediately
reclaimable and continue without Hearth. If a repeatable task contains an
expiring signed S3 request, Relay sets `inputRefreshRequired`, leaves the task
unclaimable, and exposes that flag when Hearth lists tasks after reconnecting.
Hearth then signs fresh input and re-enqueues the same task ID; Relay atomically
replaces the durable input, clears the flag, and wakes the worker. Orchestration
must use the flag rather than infer this handshake from an error message. Tasks
that reached a non-repeatable restore or delete step are marked failed for
explicit review instead of guessed at.

Effect's `Queue` is the in-process wake-up mechanism and a one-permit
`Semaphore` protects the worker. The SQLite task journal supplies durability;
an in-memory Effect queue by itself cannot meet the disconnect or restart
requirements. Effect's experimental persisted/workflow queues are not used in
the first release because Relay already has a small, proven SQLite state layer
and adopting the experimental persistence stack would add a second storage
abstraction for one consumer.

## Catalog and policy

A backup records its Relay, target kind and ID, artifact kind, reason, storage
destination, byte size, SHA-256 digest, warnings, and lifecycle timestamps.
Backup tasks separately record create, restore, and delete execution. This
keeps a successful artifact available while a later restore attempt is running
or has failed.

Targets are:

- `instance`: a game server data directory;
- `database`: a managed database logical dump;
- `platform`: Hearth's database and the recoverable Kiln configuration.

Reasons are `manual`, `pre_restore`, `final_delete`, and the reserved
`scheduled` value. Artifact kinds start with `archive`, `database_dump`, and
`platform_bundle`. A `full`/`incremental` mode is recorded independently so a
future Restic artifact does not require a catalog migration.

Each resource can set a preferred destination, exclude patterns, quantity
limit, and total logical-size limit. Platform admins can set caps. The
effective numeric limit is the lower non-null value. `0` disables new backups;
`null` is unlimited. Queued/running creates reserve one quantity slot and their
configured maximum bytes so concurrent requests cannot race past a limit.
Failed artifacts do not consume retention. Final-deletion backups bypass a
user limit but not Relay free-space safety checks or a platform cap explicitly
configured to block backups.

When adding a normal backup would exceed a limit, creation fails without
silently deleting data. A later retention policy may offer opt-in oldest-first
pruning, with protected/final backups excluded.

## Storage destinations

Relay-local storage is implicit and scoped to that Relay. Files live below a
dedicated data directory using controlled UUID paths, never user-supplied
paths. Hearth stores S3-compatible destinations with encrypted credentials.
An owner ID of `null` makes a destination platform-wide; otherwise only that
user can select it. Destination removal is blocked while cataloged artifacts
still depend on it.

S3 credentials never go to a game container and are not returned to the
browser. Hearth signs a narrowly scoped object request for Relay. The first
implementation stages one artifact locally, validates its size and digest,
then uploads it. The single queue plus free-space preflight prevents the
unbounded concurrent staging failure seen in other panels. Multipart streaming
can replace this adapter later without changing task or catalog contracts.

Object keys are generated, not supplied by users:

```text
kiln/<installation>/<relay>/<target-kind>/<target-id>/<backup-id>/<filename>
```

S3 downloads use a short-lived presigned GET. Local downloads use a
single-purpose Relay token bound to backup ID, user, expiry, and disposition.
Neither form is a permanent public URL. The default lifetime is five minutes
and can later be exposed as an admin maximum.

## Formats and live consistency

Game-server backups are portable compressed archives of the data directory.
The walker rejects path traversal and special files, understands gitignore
patterns, ignores known ephemeral lock files by default, and records files that
vanish or change size/mtime while read. A changed file is retried once; a
second change becomes a visible warning instead of being silently presented as
an application-consistent snapshot.

Running servers do not need to stop for backup. Brick-defined consistency hooks
can improve a live backup. Minecraft Bricks should run `save-off`, then
`save-all flush`, archive, and always run `save-on` in finalization. Without a
hook, Kiln promises a crash-consistent best effort, not transactional
consistency. Filesystem snapshot adapters (ZFS/Btrfs/LVM) can be added later.

Managed MySQL, MariaDB, and PostgreSQL databases stay running. Relay executes
the engine's logical dump tool into a `.dmp` stream and compresses it as
`.dmp.gz`; restore feeds the decompressed dump to the matching engine client.
Redis and Valkey require an engine snapshot followed by compression and are
reported as database dump artifacts even though their inner payload is RDB.

A platform bundle contains a logical Hearth database dump plus a versioned
manifest describing the installation and Relay registrations. Secret-bearing
configuration must be encrypted with a separately recoverable platform backup
key; using only the live Hearth secret would make disaster recovery circular.

Every artifact gets a manifest containing format version, target identity,
created time, engine/Brick metadata, exclusions, consistency warnings, logical
bytes, stored bytes, and SHA-256 digest.

## Restore and deletion safety

Game-server restore requires the instance to be stopped. Hearth can enqueue a
full safety backup first; restore is submitted only after that task succeeds.
Restore extracts into a sibling staging directory, validates every path and the
manifest, then swaps directories where the filesystem permits. If an atomic
swap is unavailable, Relay records the restore phase so recovery can complete
or roll back deterministically.

Database restore requires the database to be running. The logical import is a
tracked task and its output is bounded and redacted. A pre-restore dump is the
default recommendation.

Deleting a server or database becomes a durable compound operation: create a
`final_delete` full backup, verify it, then delete the resource. If backup
creation fails, deletion stops. A separately authorized force-delete escape
hatch can be added later; it must never be the default. S3 final backups remain
in the catalog after the resource row is gone. Relay-local final backups remain
tied to Relay availability.

## UI

Backups is the final item in the server navigation and a global page covering
servers, databases, and Kiln. Its main-sidebar button sits directly above
Activity. The page uses the shared server picker from Activity at the top and
the shared workspace table below it. Rows show name, target, destination,
reason, size, status/progress, and creation time. Actions are download,
restore, and delete. Transient outcomes use Sonner; queue state updates in
place without shifting the layout.

The create dialog selects a target and destination, shows effective quantity
and size headroom, and accepts exclusions. The restore dialog explains whether
the target must be stopped and defaults to "Take a safety backup first."
Storage configuration clearly separates platform destinations from "My S3"
destinations and never redisplays a saved secret.

## CLI

The CLI mirrors the same authorization and task APIs:

```text
kiln backups list [--server <ref>] [--database <ref>]
kiln backup create <resource> [--storage <id|local>] [--exclude <pattern>]
kiln backup status <backup-id>
kiln backup download <backup-id> [destination]
kiln backup restore <backup-id> [--safety-backup] [--confirm <resource>]
kiln backup delete <backup-id> --confirm <backup-id>
kiln backup storage list
```

`apps/cli/README.md` and `.agents/skills/kiln-cli/SKILL.md` must be updated in
the CLI layer of the stack.

## Incremental option

Restic is the preferred experiment after portable full backups are reliable.
It provides encrypted, content-addressed chunks, snapshots, S3 support, and
deduplication. Use one repository per resource for isolation and predictable
deletion; cross-resource deduplication is not worth the credential, lock, and
retention blast radius. Quantity limits map to retained snapshots, while size
limits must use logical snapshot size because physical repository bytes are
shared across snapshots.

Restic snapshots are not directly downloadable archives, so Relay must export
one through the normal download path. `forget` and `prune` are separate queued
maintenance tasks. Final-deletion backups stay full archives so recovery does
not depend on a mutable repository.

Ceph RGW is already covered by the S3-compatible adapter. CephFS/RBD snapshots
are infrastructure-specific consistency sources, not a portable backup format,
and should be an optional Relay snapshot adapter rather than the default.

## Stacked delivery

1. `feat/backup-foundation`: this design, shared contracts, permissions,
   Hearth catalog/policy schema, and Relay durable task persistence.
2. `feat/backup-engine`: Relay's single worker, portable instance archives,
   local storage, task protocol, Hearth orchestration, reconciliation, and
   limit reservation.
3. `feat/backup-s3`: encrypted platform/user destinations, S3-compatible
   signing and validation, Backblaze integration, upload/delete, and signed
   downloads.
4. `feat/backup-restore`: safe instance restore, optional pre-restore backup,
   final-backup-before-delete, and local download tokens.
5. `feat/backup-databases-platform`: compressed logical database dumps,
   database restore, Redis/Valkey snapshots, and encrypted Kiln bundles.
6. `ui/backups`: Operations table, server Backups tab, filters, dialogs,
   progress/reconciliation, storage settings, accessibility, and responsive
   browser validation.
7. `feat/backup-cli`: list/create/status/download/restore/delete/storage CLI,
   help, README, and synchronized CLI skill documentation.

Each layer receives targeted deterministic tests, full typecheck/lint, and a
T3 Preview end-to-end pass before its ready-for-review PR is opened. Runtime
layers additionally test Relay disconnect/reconnect, Relay restart recovery,
live-server creation, quantity and size rejection, restore, and final deletion.

## Reference decisions

Pterodactyl/Wings validates the value of separate Panel intent and Wings
execution, gitignore-style exclusions, portable archives, presigned S3 work,
and explicit restore status. Kiln avoids its fire-and-forget-only status model,
SHA-1 checksum, unrestricted parallel staging, and mandatory full local S3
staging as a permanent design constraint.

Coolify validates durable queued execution, execution logs, overlap guards,
per-destination retention, database-native dump tools, and treating local
success separately from S3 upload failure. Kiln uses one artifact destination
per task for an unambiguous success state, makes Relay reconciliation explicit,
and keeps schedule configuration out of the artifact/execution model.
