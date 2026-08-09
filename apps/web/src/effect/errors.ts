import { Schema } from "effect"

export class DatabaseError extends Schema.TaggedErrorClass<DatabaseError>()(
  "DatabaseError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  }
) {
  override get message() {
    return `Database operation ${this.operation} failed`
  }
}

export class FilePinLimitError extends Schema.TaggedErrorClass<FilePinLimitError>()(
  "FilePinLimitError",
  { limit: Schema.Number }
) {
  override get message() {
    return `This server already has ${this.limit} pinned files`
  }
}

export class CacheError extends Schema.TaggedErrorClass<CacheError>()(
  "CacheError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  }
) {
  override get message() {
    return `Cache operation ${this.operation} failed`
  }
}

export class CredentialError extends Schema.TaggedErrorClass<CredentialError>()(
  "CredentialError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  }
) {
  override get message() {
    return `Credential operation ${this.operation} failed`
  }
}

export class CliAccessError extends Schema.TaggedErrorClass<CliAccessError>()(
  "CliAccessError",
  {
    code: Schema.Literals([
      "access_denied",
      "authentication_required",
      "authorization_pending",
      "conflict",
      "expired_token",
      "forbidden",
      "invalid_grant",
      "invalid_request",
      "not_found",
      "rate_limited",
      "relay_unavailable",
      "sftp_unavailable",
      "slow_down",
      "unexpected_error",
    ]),
    message: Schema.String,
    retryable: Schema.Boolean,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export class AuthenticationError extends Schema.TaggedErrorClass<AuthenticationError>()(
  "AuthenticationError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export class RelayUnavailableError extends Schema.TaggedErrorClass<RelayUnavailableError>()(
  "RelayUnavailableError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export class RelayResponseError extends Schema.TaggedErrorClass<RelayResponseError>()(
  "RelayResponseError",
  {
    message: Schema.String,
    status: Schema.Number,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export class PermissionDeniedError extends Schema.TaggedErrorClass<PermissionDeniedError>()(
  "PermissionDeniedError",
  { message: Schema.String }
) {}

export class ResourceNotFoundError extends Schema.TaggedErrorClass<ResourceNotFoundError>()(
  "ResourceNotFoundError",
  {
    resource: Schema.String,
    message: Schema.String,
  }
) {}

export class ExternalServiceError extends Schema.TaggedErrorClass<ExternalServiceError>()(
  "ExternalServiceError",
  {
    service: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export class TailscaleOrchestrationError extends Schema.TaggedErrorClass<TailscaleOrchestrationError>()(
  "TailscaleOrchestrationError",
  {
    phase: Schema.Literals([
      "validation",
      "apply",
      "dns",
      "prepare",
      "rollback",
      "finalize",
      "cleanup",
    ]),
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {
  override get message() {
    return this.reason
  }
}

export type AppError =
  | AuthenticationError
  | CacheError
  | CliAccessError
  | CredentialError
  | DatabaseError
  | ExternalServiceError
  | FilePinLimitError
  | PermissionDeniedError
  | RelayResponseError
  | RelayUnavailableError
  | ResourceNotFoundError
  | TailscaleOrchestrationError
