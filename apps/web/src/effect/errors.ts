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

export type AppError =
  | AuthenticationError
  | CredentialError
  | DatabaseError
  | ExternalServiceError
  | PermissionDeniedError
  | RelayResponseError
  | RelayUnavailableError
  | ResourceNotFoundError
