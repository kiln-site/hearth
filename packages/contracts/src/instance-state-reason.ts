import { z } from "zod"

const stateReasonWithoutDetailsSchema = z
  .object({
    code: z.enum([
      "waiting_for_readiness",
      "health_check_starting",
      "health_check_failed",
      "container_restarting",
      "out_of_memory",
      "unknown",
    ]),
  })
  .strict()

const processExitStateReasonSchema = z
  .object({
    code: z.literal("process_exit"),
    exitCode: z.number().int(),
  })
  .strict()

const recoveryStateReasonSchema = z
  .object({
    code: z.literal("automatic_recovery"),
    exitCode: z.number().int().nullable(),
    phase: z.enum(["pending", "restarting", "failed"]),
    reason: z.enum([
      "clean_exit",
      "process_exit",
      "out_of_memory",
      "start_failed",
    ]),
  })
  .strict()

export const relayInstanceStateReasonSchema = z.union([
  stateReasonWithoutDetailsSchema,
  processExitStateReasonSchema,
  recoveryStateReasonSchema,
])

export type RelayInstanceStateReason = z.infer<
  typeof relayInstanceStateReasonSchema
>
