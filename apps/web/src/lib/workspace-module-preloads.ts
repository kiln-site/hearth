let fileWorkspaceModulePromise:
  | Promise<typeof import("@/components/file-workspace")>
  | undefined

export function loadFileWorkspaceModule() {
  if (!fileWorkspaceModulePromise) {
    fileWorkspaceModulePromise = import("@/components/file-workspace").catch(
      (error: unknown) => {
        fileWorkspaceModulePromise = undefined
        throw error
      }
    )
  }

  return fileWorkspaceModulePromise
}

export function warmFileWorkspaceModule() {
  void loadFileWorkspaceModule().catch(() => undefined)
}
