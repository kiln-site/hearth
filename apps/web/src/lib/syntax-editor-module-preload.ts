let syntaxCodeEditorModulePromise:
  | Promise<typeof import("@/components/syntax-code-editor")>
  | undefined

export function loadSyntaxCodeEditorModule() {
  if (!syntaxCodeEditorModulePromise) {
    syntaxCodeEditorModulePromise =
      import("@/components/syntax-code-editor").catch((error: unknown) => {
        syntaxCodeEditorModulePromise = undefined
        throw error
      })
  }

  return syntaxCodeEditorModulePromise
}

export function warmSyntaxCodeEditorModule() {
  void loadSyntaxCodeEditorModule().catch(() => undefined)
}

export function warmSyntaxCodeEditorModuleWhenIdle() {
  if (typeof window === "undefined") return

  let idleCallback: number | undefined
  let fallbackTimeout: ReturnType<typeof setTimeout> | undefined
  let secondFrame: number | undefined
  const firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(() => {
      if ("requestIdleCallback" in window) {
        idleCallback = window.requestIdleCallback(warmSyntaxCodeEditorModule, {
          timeout: 2_000,
        })
        return
      }
      fallbackTimeout = setTimeout(warmSyntaxCodeEditorModule, 500)
    })
  })

  return () => {
    window.cancelAnimationFrame(firstFrame)
    if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame)
    if (idleCallback !== undefined) window.cancelIdleCallback(idleCallback)
    if (fallbackTimeout !== undefined) clearTimeout(fallbackTimeout)
  }
}
