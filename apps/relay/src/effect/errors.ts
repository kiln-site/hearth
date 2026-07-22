import { Schema } from "effect"

export class CommandError extends Schema.TaggedErrorClass<CommandError>()(
  "CommandError",
  {
    executable: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export class RelayOperationError extends Schema.TaggedErrorClass<RelayOperationError>()(
  "RelayOperationError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  }
) {
  override get message() {
    return `Relay operation ${this.operation} failed`
  }
}

export class BrickRecipeError extends Schema.TaggedErrorClass<BrickRecipeError>()(
  "BrickRecipeError",
  {
    code: Schema.String,
    source: Schema.String,
    reason: Schema.String,
  }
) {
  override get message() {
    return `${this.reason} (${this.source})`
  }
}

export class RelayStateError extends Schema.TaggedErrorClass<RelayStateError>()(
  "RelayStateError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  }
) {
  override get message() {
    return `Relay state operation ${this.operation} failed`
  }
}

export class RelayIdentityError extends Schema.TaggedErrorClass<RelayIdentityError>()(
  "RelayIdentityError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  }
) {
  override get message() {
    return `Relay identity operation ${this.operation} failed`
  }
}

export class RelayTlsError extends Schema.TaggedErrorClass<RelayTlsError>()(
  "RelayTlsError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  }
) {
  override get message() {
    return `Relay TLS operation ${this.operation} failed`
  }
}

export class RelayPairingError extends Schema.TaggedErrorClass<RelayPairingError>()(
  "RelayPairingError",
  {
    code: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {
  override get message() {
    return this.code
  }
}
