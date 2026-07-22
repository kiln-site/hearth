import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node"
import { Context, Effect, Layer, Schema } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

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

const RelayClientRoleSchema = Schema.Literals([
  "custom",
  "full_access",
  "read_only",
])

const RelayClientRowSchema = Schema.Struct({
  actionsJson: Schema.String,
  createdAt: Schema.Number,
  id: Schema.String,
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
    readonly listInvitations: (
      now: number
    ) => Effect.Effect<ReadonlyArray<RelayInvitation>, RelayStateError>
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
  "1_relay_networking": Effect.gen(function* () {
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
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER,
        invitation_id TEXT NOT NULL,
        revoked_reason TEXT,
        revoked_at INTEGER
      ) STRICT
    `
    yield* sql`
      CREATE TABLE relay_invitations (
        id TEXT PRIMARY KEY NOT NULL,
        token_hash TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('full_access', 'read_only', 'custom')),
        actions_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
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
  }),
  "2_client_policy_and_invitation_revocation": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      ALTER TABLE relay_clients
      ADD COLUMN source_cidrs_json TEXT NOT NULL DEFAULT '[]'
    `
    yield* sql`
      ALTER TABLE relay_invitations
      ADD COLUMN revoked_at INTEGER
    `
  }),
  "3_client_observed_source": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      ALTER TABLE relay_clients
      ADD COLUMN last_address TEXT
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
