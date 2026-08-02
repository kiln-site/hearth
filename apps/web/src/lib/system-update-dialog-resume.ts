import { Option, Result, Schema } from "effect"

const updateDialogResumeStorageKey = "kiln.system-update-dialog-resume"

const UpdateDialogResumeSchema = Schema.fromJsonString(
  Schema.Struct({
    targetKey: Schema.String,
    view: Schema.Literals(["changelog", "overview"]),
  })
)

export type UpdateDialogResume = typeof UpdateDialogResumeSchema.Type

export function storeUpdateDialogResume(resume: UpdateDialogResume): void {
  Result.try(() =>
    window.sessionStorage.setItem(
      updateDialogResumeStorageKey,
      JSON.stringify(resume)
    )
  )
}

export function consumeUpdateDialogResume(): UpdateDialogResume | null {
  const stored = Result.try(() =>
    window.sessionStorage.getItem(updateDialogResumeStorageKey)
  ).pipe(Result.getOrNull)
  if (!stored) return null
  Result.try(() =>
    window.sessionStorage.removeItem(updateDialogResumeStorageKey)
  )
  return Option.getOrNull(
    Schema.decodeUnknownOption(UpdateDialogResumeSchema)(stored)
  )
}
