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
