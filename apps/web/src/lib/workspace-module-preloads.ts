import { forkPromise, tapPromiseError } from "@/effect/promise"

let fileWorkspaceModulePromise:
  | Promise<typeof import("@/components/file-workspace")>
  | undefined

export function loadFileWorkspaceModule() {
  if (!fileWorkspaceModulePromise) {
    fileWorkspaceModulePromise = tapPromiseError(
      () => import("@/components/file-workspace"),
      (error) => {
        fileWorkspaceModulePromise = undefined
        throw error
      }
    )
  }

  return fileWorkspaceModulePromise
}

export function warmFileWorkspaceModule() {
  forkPromise(loadFileWorkspaceModule)
}
