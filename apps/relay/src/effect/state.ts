import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node"
import { Context, Effect, Layer, Schema } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import type { RelayInstanceWebRoute } from "@workspace/contracts"

import { RelayStateError } from "./errors.js"

export type RelayClientRole = "custom" | "full_access" | "read_only"

export interface RelayClientGrant {
  readonly actions: ReadonlyArray<string>
  readonly id: string
  readonly name: string
  readonly origins: ReadonlyArray<string>
  readonly publicKey: string
  readonly role: RelayClientRole
  readonly sourceCidrs: ReadonlyArray<string>
}

export interface RelayClientRecord extends RelayClientGrant {
  readonly createdAt: number
  readonly invitationId: string
  readonly lastAddress: string | null
  readonly lastSeenAt: number | null
}

export interface RelayInvitationInput {
  readonly actions: ReadonlyArray<string>
  readonly createdAt: number
  readonly expiresAt: number
  readonly id: string
  readonly role: RelayClientRole
  readonly tokenHash: string
}

export interface RelayInvitation {
  readonly actions: ReadonlyArray<string>
  readonly createdAt: number
  readonly expiresAt: number
  readonly id: string
  readonly role: RelayClientRole
  readonly tokenHash: string
}

export interface PairRelayClientInput extends RelayClientGrant {
  readonly invitationId: string
  readonly pairedAt: number
}

export interface RelayAuditInput {
  readonly clientId: string | null
  readonly details: Readonly<Record<string, unknown>>
  readonly event: string
  readonly id: string
  readonly occurredAt: number
  readonly requestId: string | null
}

export interface RelayAuditRecord extends RelayAuditInput {}

export interface RelayStoredWebRoute extends RelayInstanceWebRoute {
  readonly instanceId: string
}

export interface RelayStoredInstanceName {
  readonly instanceId: string
  readonly name: string
}

const RelayClientRoleSchema = Schema.Literals([
  "custom",
  "full_access",
  "read_only",
])

const RelayClientRowSchema = Schema.Struct({
  actionsJson: Schema.String,
  createdAt: Schema.Number,
  id: Schema.String,
  invitationId: Schema.String,
  lastAddress: Schema.NullOr(Schema.String),
  lastSeenAt: Schema.NullOr(Schema.Number),
  name: Schema.String,
  originsJson: Schema.String,
  publicKey: Schema.String,
  role: RelayClientRoleSchema,
  sourceCidrsJson: Schema.String,
})

const RelayInvitationRowSchema = Schema.Struct({
  actionsJson: Schema.String,
  createdAt: Schema.Number,
  expiresAt: Schema.Number,
  id: Schema.String,
  role: RelayClientRoleSchema,
  tokenHash: Schema.String,
})

const StringArraySchema = Schema.Array(Schema.String)

const RelayWebRouteRowSchema = Schema.Struct({
  hostname: Schema.String,
  id: Schema.String,
  instanceId: Schema.String,
  path: Schema.String,
  stripPrefix: Schema.Number,
  targetPort: Schema.Number,
})

export class RelayStateStore extends Context.Service<
  RelayStateStore,
  {
    readonly appendAudit: (
      input: RelayAuditInput
    ) => Effect.Effect<void, RelayStateError>
    readonly createInvitation: (
      input: RelayInvitationInput
    ) => Effect.Effect<void, RelayStateError>
    readonly findActiveInvitation: (
      invitationId: string,
      now: number
    ) => Effect.Effect<RelayInvitation | null, RelayStateError>
    readonly findInvitationById: (
      invitationId: string
    ) => Effect.Effect<RelayInvitation | null, RelayStateError>
    readonly findClientByPublicKey: (
      publicKey: string
    ) => Effect.Effect<RelayClientRecord | null, RelayStateError>
    readonly findClientById: (
      clientId: string
    ) => Effect.Effect<RelayClientRecord | null, RelayStateError>
    readonly getMetadata: (
      key: string
    ) => Effect.Effect<string | null, RelayStateError>
    readonly listClients: () => Effect.Effect<
      ReadonlyArray<RelayClientRecord>,
      RelayStateError
    >
    readonly listAudits: (
      limit: number
    ) => Effect.Effect<ReadonlyArray<RelayAuditRecord>, RelayStateError>
    readonly listInvitations: (
      now: number
    ) => Effect.Effect<ReadonlyArray<RelayInvitation>, RelayStateError>
    readonly listInstanceNames: () => Effect.Effect<
      ReadonlyArray<RelayStoredInstanceName>,
      RelayStateError
    >
    readonly listInstanceRoutes: (
      instanceId: string
    ) => Effect.Effect<ReadonlyArray<RelayInstanceWebRoute>, RelayStateError>
    readonly listWebRoutes: () => Effect.Effect<
      ReadonlyArray<RelayStoredWebRoute>,
      RelayStateError
    >
    readonly pairClient: (
      input: PairRelayClientInput
    ) => Effect.Effect<void, RelayStateError>
    readonly revokeClient: (
      clientId: string,
      revokedAt: number
    ) => Effect.Effect<boolean, RelayStateError>
    readonly revokeInvitation: (
      invitationId: string,
      revokedAt: number
    ) => Effect.Effect<boolean, RelayStateError>
    readonly setMetadata: (
      key: string,
      value: string
    ) => Effect.Effect<void, RelayStateError>
    readonly setInstanceName: (
      instanceId: string,
      name: string
    ) => Effect.Effect<void, RelayStateError>
    readonly deleteInstanceName: (
      instanceId: string
    ) => Effect.Effect<void, RelayStateError>
    readonly replaceInstanceRoutes: (
      instanceId: string,
      routes: ReadonlyArray<RelayInstanceWebRoute>
    ) => Effect.Effect<void, RelayStateError>
    readonly touchClient: (
      clientId: string,
      seenAt: number,
      address: string | null
    ) => Effect.Effect<void, RelayStateError>
    readonly updateClient: (input: {
      readonly actions: ReadonlyArray<string>
      readonly clientId: string
      readonly name: string
      readonly role: RelayClientRole
      readonly sourceCidrs: ReadonlyArray<string>
    }) => Effect.Effect<boolean, RelayStateError>
  }
>()("kiln/RelayStateStore") {}

const migrations = SqliteMigrator.fromRecord({
  "1_initial_schema": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE relay_metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      ) STRICT
    `
    yield* sql`
      CREATE TABLE relay_clients (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        public_key TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('full_access', 'read_only', 'custom')),
        actions_json TEXT NOT NULL,
        origins_json TEXT NOT NULL,
        source_cidrs_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER,
        last_address TEXT,
        invitation_id TEXT NOT NULL,
        revoked_reason TEXT,
        revoked_at INTEGER
      ) STRICT
    `
    yield* sql`
      CREATE TABLE relay_invitations (
        id TEXT PRIMARY KEY NOT NULL,
        token_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('full_access', 'read_only', 'custom')),
        actions_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER,
        revoked_at INTEGER
      ) STRICT
    `
    yield* sql`
      CREATE INDEX relay_invitations_active
      ON relay_invitations (token_hash, expires_at)
      WHERE consumed_at IS NULL
    `
    yield* sql`
      CREATE TABLE relay_audit (
        id TEXT PRIMARY KEY NOT NULL,
        event TEXT NOT NULL,
        client_id TEXT,
        request_id TEXT,
        details_json TEXT NOT NULL,
        occurred_at INTEGER NOT NULL
      ) STRICT
    `
    yield* sql`
      CREATE INDEX relay_audit_occurred_at
      ON relay_audit (occurred_at DESC)
    `
    yield* sql`
      CREATE TABLE relay_web_routes (
        id TEXT PRIMARY KEY NOT NULL,
        instance_id TEXT NOT NULL,
        hostname TEXT NOT NULL,
        path TEXT NOT NULL DEFAULT '',
        strip_prefix INTEGER NOT NULL CHECK (strip_prefix IN (0, 1)),
        target_port INTEGER NOT NULL CHECK (target_port BETWEEN 1 AND 65535),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (hostname, path)
      ) STRICT
    `
    yield* sql`
      CREATE INDEX relay_web_routes_instance
      ON relay_web_routes (instance_id)
    `
    // Display names are labels, not identifiers. Multiple servers may
    // intentionally use the same name.
    yield* sql`
      CREATE TABLE relay_instance_names (
        instance_id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT
    `
  }),
})

const makeRelayStateStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* SqliteMigrator.run({ loader: migrations })

  const run = <T>(operation: string, effect: Effect.Effect<T, unknown>) =>
    effect.pipe(
      Effect.mapError((cause) => RelayStateError.make({ operation, cause })),
      Effect.withSpan(`relay.state.${operation}`)
    )

  const decodeClientRows = Schema.decodeUnknownEffect(
    Schema.Array(RelayClientRowSchema)
  )
  const decodeInvitationRows = Schema.decodeUnknownEffect(
    Schema.Array(RelayInvitationRowSchema)
  )
  const decodeWebRouteRows = Schema.decodeUnknownEffect(
    Schema.Array(RelayWebRouteRowSchema)
  )

  const webRoutes = Effect.fn("RelayStateStore.webRoutes")(function* (
    instanceId?: string
  ) {
    const rows = instanceId
      ? yield* sql<Record<string, unknown>>`
          SELECT
            id,
            instance_id AS instanceId,
            hostname,
            path,
            strip_prefix AS stripPrefix,
            target_port AS targetPort
          FROM relay_web_routes
          WHERE instance_id = ${instanceId}
          ORDER BY created_at ASC
        `
      : yield* sql<Record<string, unknown>>`
          SELECT
            id,
            instance_id AS instanceId,
            hostname,
            path,
            strip_prefix AS stripPrefix,
            target_port AS targetPort
          FROM relay_web_routes
          ORDER BY created_at ASC
        `
    const decoded = yield* decodeWebRouteRows(rows)
    return decoded.map((row) => ({
      hostname: row.hostname,
      id: row.id,
      instanceId: row.instanceId,
      path: row.path || null,
      stripPrefix: row.stripPrefix === 1,
      targetPort: row.targetPort,
    }))
  })

  const clientFromRow = Effect.fn("RelayStateStore.clientFromRow")(function* (
    row: typeof RelayClientRowSchema.Type
  ) {
    const [actions, origins, sourceCidrs] = yield* Effect.all([
      decodeJsonStringArray(row.actionsJson),
      decodeJsonStringArray(row.originsJson),
      decodeJsonStringArray(row.sourceCidrsJson),
    ])
    return {
      actions,
      createdAt: row.createdAt,
      id: row.id,
      invitationId: row.invitationId,
      lastAddress: row.lastAddress,
      lastSeenAt: row.lastSeenAt,
      name: row.name,
      origins,
      publicKey: row.publicKey,
      role: row.role,
      sourceCidrs,
    } satisfies RelayClientRecord
  })

  const findClientByPublicKey = Effect.fn(
    "RelayStateStore.findClientByPublicKey"
  )(function* (publicKey: string) {
    const rows = yield* sql<Record<string, unknown>>`
      SELECT
        id,
        name,
        created_at AS createdAt,
        invitation_id AS invitationId,
        last_address AS lastAddress,
        last_seen_at AS lastSeenAt,
        public_key AS publicKey,
        role,
        actions_json AS actionsJson,
        origins_json AS originsJson,
        source_cidrs_json AS sourceCidrsJson
      FROM relay_clients
      WHERE public_key = ${publicKey} AND revoked_at IS NULL
      LIMIT 1
    `
    const decoded = yield* decodeClientRows(rows)
    return decoded[0] ? yield* clientFromRow(decoded[0]) : null
  })

  const findClientById = Effect.fn("RelayStateStore.findClientById")(function* (
    clientId: string
  ) {
    const rows = yield* sql<Record<string, unknown>>`
        SELECT
          id,
          name,
          created_at AS createdAt,
          invitation_id AS invitationId,
          last_address AS lastAddress,
          last_seen_at AS lastSeenAt,
          public_key AS publicKey,
          role,
          actions_json AS actionsJson,
          origins_json AS originsJson,
          source_cidrs_json AS sourceCidrsJson
        FROM relay_clients
        WHERE id = ${clientId} AND revoked_at IS NULL
        LIMIT 1
      `
    const decoded = yield* decodeClientRows(rows)
    return decoded[0] ? yield* clientFromRow(decoded[0]) : null
  })

  return RelayStateStore.of({
    appendAudit: (input) =>
      run(
        "append_audit",
        sql`
          INSERT INTO relay_audit (
            id, event, client_id, request_id, details_json, occurred_at
          ) VALUES (
            ${input.id},
            ${input.event},
            ${input.clientId},
            ${input.requestId},
            ${JSON.stringify(input.details)},
            ${input.occurredAt}
          )
        `.pipe(Effect.asVoid)
      ),
    createInvitation: (input) =>
      run(
        "create_invitation",
        sql`
          INSERT INTO relay_invitations (
            id, token_hash, role, actions_json, created_at, expires_at
          ) VALUES (
            ${input.id},
            ${input.tokenHash},
            ${input.role},
            ${JSON.stringify(input.actions)},
            ${input.createdAt},
            ${input.expiresAt}
          )
        `.pipe(Effect.asVoid)
      ),
    findActiveInvitation: (invitationId, now) =>
      run(
        "find_active_invitation",
        Effect.gen(function* () {
          const rows = yield* sql<Record<string, unknown>>`
            SELECT
              id,
              role,
              token_hash AS tokenHash,
              actions_json AS actionsJson,
              created_at AS createdAt,
              expires_at AS expiresAt
            FROM relay_invitations
            WHERE id = ${invitationId}
              AND consumed_at IS NULL
              AND revoked_at IS NULL
              AND expires_at > ${now}
            LIMIT 1
          `
          const decoded = yield* decodeInvitationRows(rows)
          const invitation = decoded[0]
          if (!invitation) return null
          return {
            actions: yield* decodeJsonStringArray(invitation.actionsJson),
            createdAt: invitation.createdAt,
            expiresAt: invitation.expiresAt,
            id: invitation.id,
            role: invitation.role,
            tokenHash: invitation.tokenHash,
          } satisfies RelayInvitation
        })
      ),
    findClientByPublicKey: (publicKey) =>
      run("find_client_by_public_key", findClientByPublicKey(publicKey)),
    findClientById: (clientId) =>
      run("find_client_by_id", findClientById(clientId)),
    findInvitationById: (invitationId) =>
      run(
        "find_invitation_by_id",
        Effect.gen(function* () {
          const rows = yield* sql<Record<string, unknown>>`
            SELECT
              id,
              role,
              token_hash AS tokenHash,
              actions_json AS actionsJson,
              created_at AS createdAt,
              expires_at AS expiresAt
            FROM relay_invitations
            WHERE id = ${invitationId} AND revoked_at IS NULL
            LIMIT 1
          `
          const decoded = yield* decodeInvitationRows(rows)
          const invitation = decoded[0]
          if (!invitation) return null
          return {
            actions: yield* decodeJsonStringArray(invitation.actionsJson),
            createdAt: invitation.createdAt,
            expiresAt: invitation.expiresAt,
            id: invitation.id,
            role: invitation.role,
            tokenHash: invitation.tokenHash,
          } satisfies RelayInvitation
        })
      ),
    getMetadata: (key) =>
      run(
        "get_metadata",
        Effect.gen(function* () {
          const rows = yield* sql<{ value: string }>`
            SELECT value FROM relay_metadata WHERE key = ${key} LIMIT 1
          `
          return rows[0]?.value ?? null
        })
      ),
    listClients: () =>
      run(
        "list_clients",
        Effect.gen(function* () {
          const rows = yield* sql<Record<string, unknown>>`
            SELECT
              id,
              name,
              created_at AS createdAt,
              invitation_id AS invitationId,
              last_address AS lastAddress,
              last_seen_at AS lastSeenAt,
              public_key AS publicKey,
              role,
              actions_json AS actionsJson,
              origins_json AS originsJson,
              source_cidrs_json AS sourceCidrsJson
            FROM relay_clients
            WHERE revoked_at IS NULL
            ORDER BY created_at ASC
          `
          const decoded = yield* decodeClientRows(rows)
          return yield* Effect.forEach(decoded, clientFromRow)
        })
      ),
    listAudits: (limit) =>
      run(
        "list_audits",
        Effect.gen(function* () {
          const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 200)
          const rows = yield* sql<{
            clientId: string | null
            detailsJson: string
            event: string
            id: string
            occurredAt: number
            requestId: string | null
          }>`
            SELECT
              id,
              event,
              client_id AS clientId,
              request_id AS requestId,
              details_json AS detailsJson,
              occurred_at AS occurredAt
            FROM relay_audit
            ORDER BY occurred_at DESC
            LIMIT ${boundedLimit}
          `
          return rows.map((row) => ({
            clientId: row.clientId,
            details: JSON.parse(row.detailsJson) as Record<string, unknown>,
            event: row.event,
            id: row.id,
            occurredAt: row.occurredAt,
            requestId: row.requestId,
          }))
        })
      ),
    listInvitations: (now) =>
      run(
        "list_invitations",
        Effect.gen(function* () {
          const rows = yield* sql<Record<string, unknown>>`
            SELECT
              id,
              role,
              token_hash AS tokenHash,
              actions_json AS actionsJson,
              created_at AS createdAt,
              expires_at AS expiresAt
            FROM relay_invitations
            WHERE consumed_at IS NULL
              AND revoked_at IS NULL
              AND expires_at > ${now}
            ORDER BY created_at DESC
          `
          const decoded = yield* decodeInvitationRows(rows)
          return yield* Effect.forEach(decoded, (invitation) =>
            decodeJsonStringArray(invitation.actionsJson).pipe(
              Effect.map((actions) => ({
                actions,
                createdAt: invitation.createdAt,
                expiresAt: invitation.expiresAt,
                id: invitation.id,
                role: invitation.role,
                tokenHash: invitation.tokenHash,
              }))
            )
          )
        })
      ),
    listInstanceNames: () =>
      run(
        "list_instance_names",
        sql<RelayStoredInstanceName>`
          SELECT instance_id AS instanceId, name
          FROM relay_instance_names
          ORDER BY instance_id ASC
        `
      ),
    listInstanceRoutes: (instanceId) =>
      run(
        "list_instance_routes",
        webRoutes(instanceId).pipe(
          Effect.map((routes) =>
            routes.map(({ instanceId: _instanceId, ...route }) => route)
          )
        )
      ),
    listWebRoutes: () => run("list_web_routes", webRoutes()),
    pairClient: (input) =>
      run(
        "pair_client",
        sql.withTransaction(
          Effect.gen(function* () {
            const invitation = yield* sql<{ id: string }>`
              SELECT id
              FROM relay_invitations
              WHERE id = ${input.invitationId}
                AND consumed_at IS NULL
                AND revoked_at IS NULL
                AND expires_at > ${input.pairedAt}
              LIMIT 1
            `
            if (!invitation[0]) {
              return yield* Effect.fail(
                new Error("Pairing invitation is expired or already used")
              )
            }
            const existing = yield* sql<{ publicKey: string }>`
              SELECT public_key AS publicKey
              FROM relay_clients
              WHERE id = ${input.id}
              LIMIT 1
            `
            if (existing[0] && existing[0].publicKey !== input.publicKey) {
              return yield* Effect.fail(
                new Error("Relay client identity does not match")
              )
            }
            if (existing[0]) {
              yield* sql`
                UPDATE relay_clients
                SET name = ${input.name},
                    role = ${input.role},
                    actions_json = ${JSON.stringify(input.actions)},
                    origins_json = ${JSON.stringify(input.origins)},
                    source_cidrs_json = ${JSON.stringify(input.sourceCidrs)},
                    last_seen_at = ${input.pairedAt},
                    invitation_id = ${input.invitationId},
                    revoked_reason = NULL,
                    revoked_at = NULL
                WHERE id = ${input.id}
              `
            } else {
              yield* sql`
                INSERT INTO relay_clients (
                  id,
                  name,
                  public_key,
                  role,
                  actions_json,
                  origins_json,
                  source_cidrs_json,
                  created_at,
                  last_seen_at,
                  invitation_id
                ) VALUES (
                  ${input.id},
                  ${input.name},
                  ${input.publicKey},
                  ${input.role},
                  ${JSON.stringify(input.actions)},
                  ${JSON.stringify(input.origins)},
                  ${JSON.stringify(input.sourceCidrs)},
                  ${input.pairedAt},
                  ${input.pairedAt},
                  ${input.invitationId}
                )
              `
            }
            yield* sql`
              UPDATE relay_invitations
              SET consumed_at = ${input.pairedAt}
              WHERE id = ${input.invitationId} AND consumed_at IS NULL
            `
          })
        )
      ),
    revokeClient: (clientId, revokedAt) =>
      run(
        "revoke_client",
        sql.withTransaction(
          Effect.gen(function* () {
            const rows = yield* sql<{ id: string }>`
              SELECT id
              FROM relay_clients
              WHERE id = ${clientId} AND revoked_at IS NULL
              LIMIT 1
            `
            if (!rows[0]) return false
            yield* sql`
              UPDATE relay_clients
              SET revoked_at = ${revokedAt}
              WHERE id = ${clientId} AND revoked_at IS NULL
            `
            return true
          })
        )
      ),
    revokeInvitation: (invitationId, revokedAt) =>
      run(
        "revoke_invitation",
        sql.withTransaction(
          Effect.gen(function* () {
            const rows = yield* sql<{ id: string }>`
              SELECT id
              FROM relay_invitations
              WHERE id = ${invitationId}
                AND consumed_at IS NULL
                AND revoked_at IS NULL
              LIMIT 1
            `
            if (!rows[0]) return false
            yield* sql`
              UPDATE relay_invitations
              SET revoked_at = ${revokedAt}
              WHERE id = ${invitationId}
                AND consumed_at IS NULL
                AND revoked_at IS NULL
            `
            return true
          })
        )
      ),
    setMetadata: (key, value) =>
      run(
        "set_metadata",
        sql`
          INSERT INTO relay_metadata (key, value)
          VALUES (${key}, ${value})
          ON CONFLICT (key) DO UPDATE SET value = excluded.value
        `.pipe(Effect.asVoid)
      ),
    setInstanceName: (instanceId, name) =>
      run(
        "set_instance_name",
        sql`
          INSERT INTO relay_instance_names (instance_id, name, updated_at)
          VALUES (${instanceId}, ${name}, ${Date.now()})
          ON CONFLICT (instance_id) DO UPDATE
          SET name = excluded.name, updated_at = excluded.updated_at
        `.pipe(Effect.asVoid)
      ),
    deleteInstanceName: (instanceId) =>
      run(
        "delete_instance_name",
        sql`
          DELETE FROM relay_instance_names WHERE instance_id = ${instanceId}
        `.pipe(Effect.asVoid)
      ),
    replaceInstanceRoutes: (instanceId, routes) =>
      run(
        "replace_instance_routes",
        sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`
              DELETE FROM relay_web_routes WHERE instance_id = ${instanceId}
            `
            const now = Date.now()
            for (const route of routes) {
              yield* sql`
                INSERT INTO relay_web_routes (
                  id,
                  instance_id,
                  hostname,
                  path,
                  strip_prefix,
                  target_port,
                  created_at,
                  updated_at
                ) VALUES (
                  ${route.id},
                  ${instanceId},
                  ${route.hostname},
                  ${route.path ?? ""},
                  ${route.stripPrefix ? 1 : 0},
                  ${route.targetPort},
                  ${now},
                  ${now}
                )
              `
            }
          })
        )
      ),
    touchClient: (clientId, seenAt, address) =>
      run(
        "touch_client",
        sql`
          UPDATE relay_clients
          SET last_seen_at = ${seenAt}, last_address = ${address}
          WHERE id = ${clientId} AND revoked_at IS NULL
        `.pipe(Effect.asVoid)
      ),
    updateClient: (input) =>
      run(
        "update_client",
        sql.withTransaction(
          Effect.gen(function* () {
            const rows = yield* sql<{ id: string }>`
              SELECT id
              FROM relay_clients
              WHERE id = ${input.clientId} AND revoked_at IS NULL
              LIMIT 1
            `
            if (!rows[0]) return false
            yield* sql`
              UPDATE relay_clients
              SET name = ${input.name},
                  role = ${input.role},
                  actions_json = ${JSON.stringify(input.actions)},
                  source_cidrs_json = ${JSON.stringify(input.sourceCidrs)}
              WHERE id = ${input.clientId} AND revoked_at IS NULL
            `
            return true
          })
        )
      ),
  })
})

export const RelayStateStoreLive = Layer.effect(
  RelayStateStore,
  makeRelayStateStore
)

export function makeRelayStateLayer(filename: string) {
  return RelayStateStoreLive.pipe(
    Layer.provide(SqliteClient.layer({ filename }))
  )
}

function decodeJsonStringArray(value: string) {
  return Effect.try({
    try: () => JSON.parse(value) as unknown,
    catch: (cause) => RelayStateError.make({ operation: "decode_json", cause }),
  }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(StringArraySchema)))
}
