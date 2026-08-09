import { Schema } from "effect"

export class CliCommandError extends Schema.TaggedErrorClass<CliCommandError>()(
  "CliCommandError",
  {
    code: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
    exitCode: Schema.Number,
    cause: Schema.optional(Schema.Defect()),
  }
) {}

export function commandError(input: {
  cause?: unknown
  code: string
  exitCode?: number
  message: string
  retryable?: boolean
}): CliCommandError {
  return CliCommandError.make({
    code: input.code,
    message: input.message,
    retryable: input.retryable ?? false,
    exitCode: input.exitCode ?? 1,
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  })
}
