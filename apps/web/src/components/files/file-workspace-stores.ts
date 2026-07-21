import * as Sentry from "@sentry/tanstackstart-react"

export const fileEditorFontSizes = [10, 11, 12, 14, 16]
const fileEditorFontSizeStorageKey = "kiln:file-editor-font-size"
const defaultFileEditorFontSize = 16

export interface EditorSearchStore {
  getSnapshot: () => string
  setQuery: (query: string) => void
  subscribe: (listener: () => void) => () => void
}

export interface FileEditorPreferencesStore {
  getFontSizeSnapshot: () => number
  hydrate: () => void
  setFontSize: (fontSize: number) => void
  subscribe: (listener: () => void) => () => void
}

export interface EditorSessionStore {
  getDirtySnapshot: () => boolean
  getReviewChangesSnapshot: () => boolean
  getSavedValueSnapshot: () => string
  getSaveErrorSnapshot: () => string | null
  getSavingSnapshot: () => boolean
  getSearchOpenSnapshot: () => boolean
  getValue: () => string
  getWrapLinesSnapshot: () => boolean
  markSaved: (value: string) => void
  setSaveError: (error: string | null) => void
  setSaving: (saving: boolean) => void
  setSearchOpen: (open: boolean) => void
  setValue: (value: string) => void
  subscribe: (listener: () => void) => () => void
  toggleReviewChanges: () => void
  toggleWrapLines: () => void
}

export interface FileSelectionStore {
  cancelNavigation: () => void
  completeNavigation: (path: string, result: "loaded" | "unavailable") => void
  getIsHomeSnapshot: () => boolean
  getSnapshot: () => string
  navigate: (path: string, from: string, to: string) => void
  select: (path: string) => void
  subscribe: (listener: () => void) => () => void
}

export function createFileSelectionStore(
  initialPath: string
): FileSelectionStore {
  let path = initialPath
  let navigation:
    | {
        path: string
        span: ReturnType<typeof Sentry.startInactiveSpan>
      }
    | undefined
  const listeners = new Set<() => void>()
  const select = (nextPath: string) => {
    if (path === nextPath) return
    path = nextPath
    for (const listener of listeners) listener()
  }
  return {
    cancelNavigation: () => {
      if (!navigation) return
      navigation.span.setAttribute("kiln.file.result", "cancelled")
      navigation.span.end()
      navigation = undefined
    },
    completeNavigation: (completedPath, result) => {
      if (navigation?.path !== completedPath) return
      navigation.span.setAttribute("kiln.file.result", result)
      navigation.span.end()
      navigation = undefined
    },
    getIsHomeSnapshot: () => path === "",
    getSnapshot: () => path,
    navigate: (nextPath, from, to) => {
      if (navigation) {
        navigation.span.setAttribute("kiln.file.result", "superseded")
        navigation.span.end()
      }
      Sentry.addBreadcrumb({
        category: "navigation",
        type: "navigation",
        data: { from, to },
      })
      navigation = {
        path: nextPath,
        span: Sentry.startInactiveSpan({
          name: to,
          op: "navigation",
          forceTransaction: true,
          attributes: {
            "sentry.source": "route",
            "kiln.navigation.type": "file",
          },
        }),
      }
      select(nextPath)
    },
    select,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function createEditorSearchStore(): EditorSearchStore {
  let query = ""
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => query,
    setQuery: (nextQuery) => {
      if (query === nextQuery) return
      query = nextQuery
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function createFileEditorPreferencesStore(): FileEditorPreferencesStore {
  let fontSize = defaultFileEditorFontSize
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const setFontSize = (nextFontSize: number) => {
    if (
      fontSize === nextFontSize ||
      !fileEditorFontSizes.includes(nextFontSize)
    ) {
      return
    }
    fontSize = nextFontSize
    try {
      window.localStorage.setItem(
        fileEditorFontSizeStorageKey,
        String(nextFontSize)
      )
    } catch {
      // The editor remains usable when browser storage is unavailable.
    }
    notify()
  }
  return {
    getFontSizeSnapshot: () => fontSize,
    hydrate: () => {
      try {
        const storedValue = Number.parseInt(
          window.localStorage.getItem(fileEditorFontSizeStorageKey) ?? "",
          10
        )
        setFontSize(storedValue)
      } catch {
        // Keep the default when browser storage is unavailable.
      }
    },
    setFontSize,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function createEditorSessionStore(
  initialValue: string
): EditorSessionStore {
  let value = initialValue
  let savedValue = initialValue
  let dirty = false
  let saving = false
  let saveError: string | null = null
  let searchOpen = false
  let reviewChanges = true
  let wrapLines = true
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  return {
    getDirtySnapshot: () => dirty,
    getReviewChangesSnapshot: () => reviewChanges,
    getSavedValueSnapshot: () => savedValue,
    getSaveErrorSnapshot: () => saveError,
    getSavingSnapshot: () => saving,
    getSearchOpenSnapshot: () => searchOpen,
    getValue: () => value,
    getWrapLinesSnapshot: () => wrapLines,
    markSaved: (nextSavedValue) => {
      savedValue = nextSavedValue
      dirty = value !== savedValue
      notify()
    },
    setSaveError: (nextError) => {
      if (saveError === nextError) return
      saveError = nextError
      notify()
    },
    setSaving: (nextSaving) => {
      if (saving === nextSaving) return
      saving = nextSaving
      notify()
    },
    setSearchOpen: (nextOpen) => {
      if (searchOpen === nextOpen) return
      searchOpen = nextOpen
      notify()
    },
    setValue: (nextValue) => {
      value = nextValue
      const nextDirty = value !== savedValue
      if (dirty === nextDirty) return
      dirty = nextDirty
      notify()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    toggleReviewChanges: () => {
      reviewChanges = !reviewChanges
      notify()
    },
    toggleWrapLines: () => {
      wrapLines = !wrapLines
      notify()
    },
  }
}
