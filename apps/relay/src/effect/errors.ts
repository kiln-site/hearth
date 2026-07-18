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
