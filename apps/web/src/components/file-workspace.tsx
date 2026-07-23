import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { FileTree, useFileTree, useFileTreeSearch } from "@pierre/trees/react"
import type {
  RelayFileActivity,
  RelayFileActivityEntry,
  RelayFileContent,
  RelayFileTree,
} from "@workspace/contracts"
import {
  ALargeSmall,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  Download,
  EllipsisVertical,
  FileCode2,
  FilePlus,
  FolderTree,
  FolderPlus,
  GitCompareArrows,
  GripVertical,
  HardDriveDownload,
  House,
  LoaderCircle,
  LockKeyhole,
  Network,
  PanelLeftClose,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Save,
  Search,
  Share2,
  TriangleAlert,
  Upload,
  WrapText,
  X,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { floatingSurfaceClassName } from "@workspace/ui/lib/surface-styles"
import { showToast } from "@workspace/ui/components/sonner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { SyntaxCodeEditor } from "@/components/syntax-code-editor"
import type { SyntaxCodeEditorHandle } from "@/components/syntax-code-editor"
import {
  FileTreeLoadingPanel,
  FileWorkspaceLoadingState,
} from "@/components/file-tree-loading-panel"
import {
  createEditorSearchStore,
  createEditorSessionStore,
  createFileEditorPreferencesStore,
  createFileSelectionStore,
  fileEditorFontSizes,
} from "@/components/files/file-workspace-stores"
import type {
  EditorSearchStore,
  EditorSessionStore,
  FileEditorPreferencesStore,
  FileSelectionStore,
} from "@/components/files/file-workspace-stores"
import { redactSensitiveText } from "@/lib/redaction"
import { fileLanguageForPath } from "@/lib/file-language"
import { downloadRelayFile, uploadRelayFile } from "@/lib/relay-file-transfer"
import type { InstanceWorkspaceInstance } from "@/lib/relay-selectors"
import {
  queryKeys,
  relayFileActivityQueryOptions,
  relayFileQueryOptions,
  relayTreeQueryOptions,
} from "@/lib/query-options"
import {
  getRelayTree,
  saveRelayFile,
  updateRelayFilePin,
  uploadToMclogs,
} from "@/server/relay"

function formatName(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path
}

const fileEditorHeaderClassName =
  "flex h-14 shrink-0 border-b md:h-auto md:min-h-14"
const fileEditorHeaderContentClassName =
  "flex min-w-0 flex-1 items-center gap-2 px-2 sm:px-3 md:flex-wrap md:gap-x-3 md:gap-y-2 md:py-[7px]"

const fileTreeWidthCookieName = "file_tree_width"
const fileTreeCollapsedCookieName = "file_tree_collapsed"
const fileTreeCookieMaxAge = 60 * 60 * 24 * 7
const fileTreeMinWidth = 224
const fileTreeMaxWidth = 480
const mobileFileDrawerTransitionMs = 200
const recentFileDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
})
const olderFileDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
})

function persistFileTreeWidth(width: number) {
  document.cookie = `${fileTreeWidthCookieName}=${width}; path=/; max-age=${fileTreeCookieMaxAge}; SameSite=Lax`
}

const fileTreeLayoutCss = `
  [data-item-section="content"] {
    flex: 1 1 auto;
  }

  [data-item-section="decoration"]:empty {
    display: none;
  }

  [data-truncate-marker] {
    opacity: 0;
  }

  @container measure (height > calc(1lh + 1px)) {
    [data-truncate-marker] {
      opacity: 1;
    }
  }

  [data-icon-name="file-tree-icon-chevron"] {
    width: 14px;
    height: 14px;
  }
`
function clampFileTreeWidth(width: number, workspaceWidth: number) {
  const responsiveMaximum = Math.floor(workspaceWidth * 0.45)
  const maximum = Math.max(
    fileTreeMinWidth,
    Math.min(fileTreeMaxWidth, responsiveMaximum)
  )
  return Math.min(maximum, Math.max(fileTreeMinWidth, Math.round(width)))
}

function defaultFileTreeWidth() {
  return window.innerWidth >= 1280 ? 304 : 280
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const textarea = document.createElement("textarea")
    textarea.value = value
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    document.body.append(textarea)
    textarea.select()
    const copied = document.execCommand("copy")
    textarea.remove()
    if (!copied) throw new Error("Could not copy to clipboard")
  }
}

function FileTreeRevealButton({ onClick }: { onClick: () => void }) {
  return (
    <div
      className="hidden shrink-0 self-stretch border-r md:flex"
      style={{ width: "var(--file-editor-gutter-width, 3rem)" }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="grid size-full place-items-center text-primary transition-colors outline-none hover:bg-accent/45 hover:text-primary focus-visible:bg-accent/55 focus-visible:ring-1 focus-visible:ring-ring/60 focus-visible:ring-inset"
            aria-label="Open file tree"
            onClick={onClick}
          >
            <FolderTree className="size-[17px]" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={7}>
          Open File Tree
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

function FilesHomeButton({
  active = false,
  onClick,
}: {
  active?: boolean
  onClick: () => void
}) {
  return (
    <EditorTooltip content="Files Home">
      <Button
        variant="ghost"
        size="icon-sm"
        className={`shrink-0 shadow-none ${active ? "text-primary hover:bg-transparent hover:text-primary focus-visible:bg-transparent" : ""}`}
        aria-label="Files home"
        aria-current={active ? "page" : undefined}
        onClick={onClick}
      >
        <House className="size-[18px]" />
      </Button>
    </EditorTooltip>
  )
}

function FilePathCopyButton({ path }: { path: string }) {
  const [copyState, setCopyState] = React.useState<"idle" | "copied">("idle")
  const resetTimer = React.useRef<number | null>(null)
  const fullFilePath = `/data/${path.replace(/^\/+/, "")}`

  React.useEffect(
    () => () => {
      if (resetTimer.current) window.clearTimeout(resetTimer.current)
    },
    []
  )

  async function handleCopy() {
    await copyToClipboard(fullFilePath)
    setCopyState("copied")
    if (resetTimer.current) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setCopyState("idle"), 1800)
  }

  return (
    <EditorTooltip
      content={copyState === "copied" ? "File Path Copied" : "Copy File Path"}
    >
      <button
        type="button"
        className="group/path flex max-w-full items-center gap-1 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none sm:text-[11px]"
        aria-label={
          copyState === "copied"
            ? `Copied ${fullFilePath}`
            : `Copy ${fullFilePath}`
        }
        onClick={handleCopy}
      >
        <span className="truncate">{fullFilePath}</span>
        {copyState === "copied" ? (
          <Check className="size-3.5 shrink-0 text-primary" />
        ) : (
          <Copy className="size-3.5 shrink-0 opacity-65 transition-opacity group-hover/path:opacity-100" />
        )}
      </button>
    </EditorTooltip>
  )
}

function FileToolbarIdentity({
  path,
  pathIsCopyable = true,
  readOnly = false,
}: {
  path: string
  pathIsCopyable?: boolean
  readOnly?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5 md:gap-3">
      <FileCode2 className="size-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex min-w-0 items-center gap-2.5">
          <p className="min-w-0 truncate text-sm font-semibold">
            {formatName(path)}
          </p>
          {readOnly ? (
            <span className="hidden shrink-0 border border-primary/20 bg-primary/8 px-2 py-0.5 font-mono text-[9px] tracking-wider text-primary sm:inline-flex">
              READ ONLY
            </span>
          ) : null}
        </div>
        {pathIsCopyable ? (
          <FilePathCopyButton key={path} path={path} />
        ) : (
          <p className="truncate font-mono text-[10px] text-muted-foreground sm:text-[11px]">
            /data/{path}
          </p>
        )}
      </div>
    </div>
  )
}

const StableFileToolbarIdentity = React.memo(FileToolbarIdentity)

function Editor({
  file,
  displayPath,
  instance,
  loading: queryLoading,
  error,
  canShare,
  canWrite,
  preferencesStore,
  treeCollapsed,
  onTreeExpand,
}: {
  file: RelayFileContent
  displayPath: string
  instance: InstanceWorkspaceInstance
  loading: boolean
  error: string | null
  canShare: boolean
  canWrite: boolean
  preferencesStore: FileEditorPreferencesStore
  treeCollapsed: boolean
  onTreeExpand: () => void
}) {
  const [sessionStore] = React.useState(() =>
    createEditorSessionStore(file.content)
  )
  const searchStore = React.useMemo(createEditorSearchStore, [])
  const editorRef = React.useRef<SyntaxCodeEditorHandle>(null)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const sectionRef = React.useRef<HTMLElement>(null)
  const initialValue = React.useRef(file.content).current
  const loading = queryLoading

  React.useLayoutEffect(() => {
    const section = sectionRef.current
    const gutters = section?.querySelector<HTMLElement>(".cm-gutters")
    if (!section || !gutters) return
    const sectionElement = section
    const gutterElement = gutters

    function syncGutterWidth() {
      const nextWidth = `${gutterElement.getBoundingClientRect().width}px`
      if (
        sectionElement.style.getPropertyValue("--file-editor-gutter-width") ===
        nextWidth
      ) {
        return
      }
      sectionElement.style.setProperty("--file-editor-gutter-width", nextWidth)
    }

    syncGutterWidth()
    const observer = new ResizeObserver(syncGutterWidth)
    observer.observe(gutterElement)
    return () => observer.disconnect()
  }, [file.path])

  return (
    <section
      ref={sectionRef}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-card"
    >
      <EditorSearchBoundary
        editorRef={editorRef}
        inputRef={searchInputRef}
        searchStore={searchStore}
        sessionStore={sessionStore}
      >
        <PopoverAnchor asChild>
          <div className={fileEditorHeaderClassName} data-file-toolbar>
            {treeCollapsed ? (
              <FileTreeRevealButton onClick={onTreeExpand} />
            ) : null}
            <div className={fileEditorHeaderContentClassName}>
              <StableFileToolbarIdentity
                path={displayPath}
                readOnly={file.encoding === "gzip"}
              />

              <EditorResponsiveActions
                canShare={canShare}
                canWrite={canWrite}
                file={file}
                instance={instance}
                loading={loading}
                preferencesStore={preferencesStore}
                sessionStore={sessionStore}
              />
            </div>
          </div>
        </PopoverAnchor>
      </EditorSearchBoundary>

      <div className="editor-grid relative min-h-[360px] min-w-0 flex-1 overflow-hidden">
        <StableEditorDocument
          editorRef={editorRef}
          ariaLabel={`Edit ${formatName(file.path)}`}
          initialValue={initialValue}
          path={file.path}
          disabled={loading}
          redactSensitive
          readOnly={file.readOnly || !canWrite}
          preferencesStore={preferencesStore}
          searchStore={searchStore}
          sessionStore={sessionStore}
        />
        {loading ? (
          <div className="absolute inset-y-0 right-0 left-[var(--file-editor-gutter-width,3rem)] z-20 grid place-items-center bg-card/75 backdrop-blur-[2px]">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin text-primary" />
              Reading from Relay
            </div>
          </div>
        ) : null}
      </div>

      <EditorFooter error={error} file={file} sessionStore={sessionStore} />
    </section>
  )
}

function EditorResponsiveActions({
  canShare,
  canWrite,
  file,
  instance,
  loading,
  preferencesStore,
  sessionStore,
}: {
  canShare: boolean
  canWrite: boolean
  file: RelayFileContent
  instance: InstanceWorkspaceInstance
  loading: boolean
  preferencesStore: FileEditorPreferencesStore
  sessionStore: EditorSessionStore
}) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <div className="ml-auto flex shrink-0 items-center gap-1 md:hidden">
        <StableEditorSearchToggleButton
          loading={loading}
          sessionStore={sessionStore}
        />
        <EditorSaveButton
          file={file}
          instance={instance}
          loading={loading}
          sessionStore={sessionStore}
        />
        <StableEditorMobileOverflowMenu
          canShare={canShare}
          canWrite={canWrite}
          filePath={file.path}
          fileReadOnly={file.readOnly}
          instance={instance}
          loading={loading}
          preferencesStore={preferencesStore}
          sessionStore={sessionStore}
        />
      </div>
    )
  }

  return (
    <div
      className="ml-auto hidden max-w-full min-w-0 flex-wrap items-center justify-end gap-1 md:flex"
      data-file-editor-actions
    >
      {canShare ? (
        <StableEditorShareButton
          instance={instance}
          loading={loading}
          path={file.path}
          sessionStore={sessionStore}
        />
      ) : null}
      <StableEditorSearchToggleButton
        loading={loading}
        sessionStore={sessionStore}
      />
      <StableEditorFontSizeButton preferencesStore={preferencesStore} />
      <StableEditorWrapButton sessionStore={sessionStore} />
      <StableEditorCopyButton sessionStore={sessionStore} />
      <EditorTooltip content="Download - Coming Soon">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Download - Coming Soon"
          disabled
        >
          <Download className="size-[17px]" />
        </Button>
      </EditorTooltip>
      <EditorSaveButton
        file={file}
        instance={instance}
        loading={loading}
        sessionStore={sessionStore}
      />
      <StableEditorOverflowMenu
        canWrite={canWrite}
        filePath={file.path}
        fileReadOnly={file.readOnly}
        instance={instance}
        loading={loading}
        sessionStore={sessionStore}
      />
    </div>
  )
}

function EditorSearchBoundary({
  children,
  editorRef,
  inputRef,
  searchStore,
  sessionStore,
}: {
  children: React.ReactElement
  editorRef: React.RefObject<SyntaxCodeEditorHandle | null>
  inputRef: React.RefObject<HTMLInputElement | null>
  searchStore: EditorSearchStore
  sessionStore: EditorSessionStore
}) {
  const open = React.useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSearchOpenSnapshot,
    sessionStore.getSearchOpenSnapshot
  )

  return (
    <Popover open={open} onOpenChange={sessionStore.setSearchOpen}>
      {children}
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={7}
        collisionPadding={12}
        className="w-[min(18rem,calc(100vw-1rem))] p-2"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <EditorSearchContent
          editorRef={editorRef}
          inputRef={inputRef}
          store={searchStore}
          onClose={() => sessionStore.setSearchOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

function EditorSearchToggleButton({
  loading,
  sessionStore,
}: {
  loading: boolean
  sessionStore: EditorSessionStore
}) {
  const open = React.useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSearchOpenSnapshot,
    sessionStore.getSearchOpenSnapshot
  )
  return (
    <EditorTooltip content={open ? "Hide Search in File" : "Search in File"}>
      <Button
        variant={open ? "secondary" : "ghost"}
        size="icon"
        className="disabled:opacity-100"
        aria-label={open ? "Close file search" : "Search file"}
        aria-pressed={open}
        aria-keyshortcuts="Control+F Meta+F"
        disabled={loading}
        onClick={() => sessionStore.setSearchOpen(!open)}
      >
        <Search className="size-[17px]" />
      </Button>
    </EditorTooltip>
  )
}

function useEditorShareAction({
  instance,
  path,
  sessionStore,
}: {
  instance: InstanceWorkspaceInstance
  path: string
  sessionStore: EditorSessionStore
}) {
  const [state, setState] = React.useState<
    "idle" | "uploading" | "copied" | "error"
  >("idle")
  const resetTimer = React.useRef<number | null>(null)
  React.useEffect(
    () => () => {
      if (resetTimer.current) window.clearTimeout(resetTimer.current)
    },
    []
  )

  async function handleShare() {
    setState("uploading")
    try {
      const result = await uploadToMclogs({
        data: {
          content: redactSensitiveText(sessionStore.getValue()),
          instanceId: instance.id,
          relayId: instance.relayId,
          path,
          implementation: instance.implementation,
          version: instance.version,
        },
      })
      await copyToClipboard(result.url)
      setState("copied")
    } catch {
      setState("error")
    }
    if (resetTimer.current) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setState("idle"), 2800)
  }

  return { share: handleShare, state }
}

function EditorShareButton({
  instance,
  loading,
  path,
  sessionStore,
}: {
  instance: InstanceWorkspaceInstance
  loading: boolean
  path: string
  sessionStore: EditorSessionStore
}) {
  const { share, state } = useEditorShareAction({
    instance,
    path,
    sessionStore,
  })

  return (
    <EditorTooltip
      content={
        state === "uploading"
          ? "Uploading to mclo.gs"
          : state === "copied"
            ? "Link Copied"
            : state === "error"
              ? "Retry mclo.gs Upload"
              : "Upload to mclo.gs"
      }
    >
      <Button
        variant={
          state === "copied"
            ? "secondary"
            : state === "error"
              ? "destructive"
              : "ghost"
        }
        size="default"
        className="h-8 shrink-0 gap-1.5 px-2.5 text-xs shadow-none disabled:opacity-100"
        aria-label={`Upload ${formatName(path)} to mclo.gs and copy link`}
        disabled={state === "uploading" || loading}
        onClick={share}
      >
        {state === "uploading" ? (
          <LoaderCircle className="size-[17px] animate-spin" />
        ) : state === "copied" ? (
          <Check className="size-[17px]" />
        ) : state === "error" ? (
          <TriangleAlert className="size-[17px]" />
        ) : (
          <Share2 className="size-[17px]" />
        )}
        <span>
          {state === "uploading"
            ? "Uploading"
            : state === "copied"
              ? "Link copied"
              : state === "error"
                ? "Try again"
                : "mclo.gs"}
        </span>
      </Button>
    </EditorTooltip>
  )
}

function useEditorCopyAction(sessionStore: EditorSessionStore) {
  const [copied, setCopied] = React.useState(false)
  const resetTimer = React.useRef<number | null>(null)
  React.useEffect(
    () => () => {
      if (resetTimer.current) window.clearTimeout(resetTimer.current)
    },
    []
  )

  async function copy() {
    await copyToClipboard(redactSensitiveText(sessionStore.getValue()))
    setCopied(true)
    if (resetTimer.current) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setCopied(false), 1800)
  }

  return { copied, copy }
}

function EditorCopyButton({
  sessionStore,
}: {
  sessionStore: EditorSessionStore
}) {
  const { copied, copy } = useEditorCopyAction(sessionStore)

  return (
    <EditorTooltip
      content={copied ? "File Contents Copied" : "Copy File Contents"}
    >
      <Button
        variant={copied ? "secondary" : "ghost"}
        size="icon"
        aria-label={copied ? "File Contents Copied" : "Copy File Contents"}
        onClick={copy}
      >
        {copied ? (
          <Check className="size-[17px]" />
        ) : (
          <Copy className="size-[17px]" />
        )}
      </Button>
    </EditorTooltip>
  )
}

function EditorWrapButton({
  sessionStore,
}: {
  sessionStore: EditorSessionStore
}) {
  const wrapLines = React.useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getWrapLinesSnapshot,
    sessionStore.getWrapLinesSnapshot
  )
  return (
    <EditorTooltip
      content={wrapLines ? "Disable Line Wrap" : "Enable Line Wrap"}
    >
      <Button
        variant={wrapLines ? "secondary" : "ghost"}
        size="icon"
        aria-label={wrapLines ? "Disable line wrap" : "Enable line wrap"}
        aria-pressed={wrapLines}
        onClick={sessionStore.toggleWrapLines}
      >
        <WrapText className="size-[17px]" />
      </Button>
    </EditorTooltip>
  )
}

function EditorReviewChangesMenuItem({
  fileReadOnly,
  labelMode,
  loading,
  sessionStore,
}: {
  fileReadOnly: boolean
  labelMode: "dynamic" | "static"
  loading: boolean
  sessionStore: EditorSessionStore
}) {
  const dirty = React.useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getDirtySnapshot,
    sessionStore.getDirtySnapshot
  )
  const reviewChanges = React.useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getReviewChangesSnapshot,
    sessionStore.getReviewChangesSnapshot
  )
  const label =
    labelMode === "static"
      ? "Review changes"
      : dirty
        ? reviewChanges
          ? "Hide changes"
          : "Highlight changes"
        : "Review changes"

  return (
    <FileActionMenuItem
      active={dirty && reviewChanges}
      icon={<GitCompareArrows />}
      label={label}
      detail="Compare with the saved file"
      disabled={!dirty || loading || fileReadOnly}
      onClick={sessionStore.toggleReviewChanges}
    />
  )
}

function EditorOverflowMenu({
  canWrite,
  filePath,
  fileReadOnly,
  instance,
  loading,
  sessionStore,
}: {
  canWrite: boolean
  filePath: string
  fileReadOnly: boolean
  instance: InstanceWorkspaceInstance
  loading: boolean
  sessionStore: EditorSessionStore
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={open ? "secondary" : "ghost"}
          size="icon"
          aria-label="More file actions"
          aria-expanded={open}
          title="More file actions"
        >
          <EllipsisVertical className="size-[18px]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={7}
        collisionPadding={8}
        className="w-[min(17rem,calc(100vw-1rem))] p-1"
      >
        <p className="border-b px-2 py-2 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          File actions
        </p>
        <FilePinActionMenuItem
          canWrite={canWrite}
          editorLoading={loading}
          instance={instance}
          path={filePath}
        />
        <EditorReviewChangesMenuItem
          fileReadOnly={fileReadOnly}
          labelMode="dynamic"
          loading={loading}
          sessionStore={sessionStore}
        />
        <EditorDownloadActionMenuItem
          instance={instance}
          loading={loading}
          path={filePath}
        />
      </PopoverContent>
    </Popover>
  )
}

function EditorMobileFontSizeSection({
  preferencesStore,
}: {
  preferencesStore: FileEditorPreferencesStore
}) {
  const fontSize = React.useSyncExternalStore(
    preferencesStore.subscribe,
    preferencesStore.getFontSizeSnapshot,
    preferencesStore.getFontSizeSnapshot
  )

  return (
    <div className="border-t border-border/45 px-2 py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs font-medium text-foreground">
          <ALargeSmall className="size-4 text-muted-foreground" /> Text size
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {fontSize}px
        </span>
      </div>
      <EditorFontSizeControl
        fontSize={fontSize}
        onFontSizeChange={preferencesStore.setFontSize}
      />
    </div>
  )
}

function EditorShareActionMenuItem({
  instance,
  loading,
  path,
  sessionStore,
}: {
  instance: InstanceWorkspaceInstance
  loading: boolean
  path: string
  sessionStore: EditorSessionStore
}) {
  const { share, state } = useEditorShareAction({
    instance,
    path,
    sessionStore,
  })

  return (
    <FileActionMenuItem
      icon={
        state === "uploading" ? (
          <LoaderCircle className="animate-spin" />
        ) : state === "copied" ? (
          <Check />
        ) : state === "error" ? (
          <TriangleAlert />
        ) : (
          <Share2 />
        )
      }
      label={
        state === "uploading"
          ? "Uploading"
          : state === "copied"
            ? "Link copied"
            : state === "error"
              ? "Try mclo.gs again"
              : "Upload to mclo.gs"
      }
      detail="Copies a shareable link"
      disabled={state === "uploading" || loading}
      onClick={share}
    />
  )
}

function EditorWrapActionMenuItem({
  sessionStore,
}: {
  sessionStore: EditorSessionStore
}) {
  const wrapLines = React.useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getWrapLinesSnapshot,
    sessionStore.getWrapLinesSnapshot
  )

  return (
    <FileActionMenuItem
      active={wrapLines}
      icon={<WrapText />}
      label="Wrap long lines"
      detail="Fit text to the editor"
      onClick={sessionStore.toggleWrapLines}
    />
  )
}

function EditorCopyActionMenuItem({
  sessionStore,
}: {
  sessionStore: EditorSessionStore
}) {
  const { copied, copy } = useEditorCopyAction(sessionStore)

  return (
    <FileActionMenuItem
      icon={copied ? <Check /> : <Copy />}
      label={copied ? "Contents copied" : "Copy contents"}
      detail="Redacts IP addresses"
      onClick={copy}
    />
  )
}

function EditorDownloadActionMenuItem({
  instance,
  loading,
  path,
}: {
  instance: InstanceWorkspaceInstance
  loading: boolean
  path: string
}) {
  const [downloading, setDownloading] = React.useState(false)
  const download = React.useCallback(async () => {
    setDownloading(true)
    try {
      await downloadRelayFile({
        instanceId: instance.id,
        path,
        relayId: instance.relayId,
      })
    } catch (cause) {
      showToast({
        type: "error",
        message: "Could not download file",
        description:
          cause instanceof Error
            ? cause.message
            : "The Relay could not complete the download.",
      })
    } finally {
      setDownloading(false)
    }
  }, [instance.id, instance.relayId, path])

  return (
    <FileActionMenuItem
      icon={
        downloading ? <LoaderCircle className="animate-spin" /> : <Download />
      }
      label={downloading ? "Preparing download" : "Download"}
      detail="Transfer directly from Relay"
      disabled={loading || downloading}
      onClick={() => void download()}
    />
  )
}

function EditorMobileOverflowMenu({
  canShare,
  canWrite,
  filePath,
  fileReadOnly,
  instance,
  loading,
  preferencesStore,
  sessionStore,
}: {
  canShare: boolean
  canWrite: boolean
  filePath: string
  fileReadOnly: boolean
  instance: InstanceWorkspaceInstance
  loading: boolean
  preferencesStore: FileEditorPreferencesStore
  sessionStore: EditorSessionStore
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={open ? "secondary" : "ghost"}
          size="icon"
          className="shadow-none"
          aria-label="More file actions"
          aria-expanded={open}
        >
          <EllipsisVertical className="size-[18px]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={7}
        collisionPadding={8}
        className="w-[min(18rem,calc(100vw-1rem))] p-1.5"
      >
        <p className="px-2 pt-1 pb-1.5 font-mono text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
          File actions
        </p>
        <EditorMobileFontSizeSection preferencesStore={preferencesStore} />
        {canShare ? (
          <EditorShareActionMenuItem
            instance={instance}
            loading={loading}
            path={filePath}
            sessionStore={sessionStore}
          />
        ) : null}
        <FilePinActionMenuItem
          canWrite={canWrite}
          editorLoading={loading}
          instance={instance}
          path={filePath}
        />
        <EditorWrapActionMenuItem sessionStore={sessionStore} />
        <EditorCopyActionMenuItem sessionStore={sessionStore} />
        <EditorReviewChangesMenuItem
          fileReadOnly={fileReadOnly}
          labelMode="static"
          loading={loading}
          sessionStore={sessionStore}
        />
        <EditorDownloadActionMenuItem
          instance={instance}
          loading={loading}
          path={filePath}
        />
      </PopoverContent>
    </Popover>
  )
}

const StableEditorSearchToggleButton = React.memo(EditorSearchToggleButton)
const StableEditorShareButton = React.memo(EditorShareButton)
const StableEditorFontSizeButton = React.memo(EditorFontSizeButton)
const StableEditorWrapButton = React.memo(EditorWrapButton)
const StableEditorCopyButton = React.memo(EditorCopyButton)
const StableEditorOverflowMenu = React.memo(EditorOverflowMenu)
const StableEditorMobileOverflowMenu = React.memo(EditorMobileOverflowMenu)

function EditorFooter({
  error,
  file,
  sessionStore,
}: {
  error: string | null
  file: RelayFileContent
  sessionStore: EditorSessionStore
}) {
  const saveError = React.useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSaveErrorSnapshot,
    sessionStore.getSaveErrorSnapshot
  )
  return (
    <div className="flex h-7 shrink-0 items-center justify-between border-t bg-muted/10 px-3 font-mono text-[9px] text-muted-foreground">
      <span className={error || saveError ? "text-destructive" : undefined}>
        {error ||
          saveError ||
          (file.encoding === "gzip"
            ? `${file.size.toLocaleString()} B GZIP → ${file.decodedSize.toLocaleString()} B TEXT`
            : `${file.size.toLocaleString()} BYTES`)}
      </span>
      <div className="flex items-center gap-3">
        <span>UTF-8</span>
        <span>LF</span>
        <span>{fileLanguageForPath(file.path).label}</span>
      </div>
    </div>
  )
}

function useFilePinAction(instance: InstanceWorkspaceInstance, path: string) {
  const queryClient = useQueryClient()
  const selectPinned = React.useCallback(
    (activity: RelayFileActivity) =>
      activity.files.find((entry) => entry.path === path)?.pinned ?? false,
    [path]
  )
  const pinQuery = useQuery({
    ...relayFileActivityQueryOptions(instance.relayId, instance.id),
    select: selectPinned,
  })
  const pinMutation = useMutation({
    mutationFn: updateRelayFilePin,
    onSuccess: (nextActivity) => {
      queryClient.setQueryData(
        queryKeys.relay.fileActivity(instance.relayId, instance.id),
        nextActivity
      )
    },
  })
  const pinned = pinQuery.data ?? false
  const updatePinned = pinMutation.mutate
  const setPinned = React.useCallback(
    (nextPinned: boolean) => {
      updatePinned({
        data: {
          instanceId: instance.id,
          relayId: instance.relayId,
          path,
          pinned: nextPinned,
        },
      })
    },
    [instance.id, instance.relayId, path, updatePinned]
  )
  const error = queryErrorMessage(
    pinMutation.error,
    "Could not update file pin"
  )

  return {
    error,
    loading: pinQuery.isPending,
    pinned,
    pinning: pinMutation.isPending,
    setPinned,
  }
}

function FilePinActionMenuItem({
  canWrite,
  editorLoading,
  instance,
  path,
}: {
  canWrite: boolean
  editorLoading: boolean
  instance: InstanceWorkspaceInstance
  path: string
}) {
  const { error, loading, pinned, pinning, setPinned } = useFilePinAction(
    instance,
    path
  )

  return (
    <FileActionMenuItem
      active={pinned}
      icon={pinned ? <PinOff /> : <Pin />}
      label={pinned ? "Unpin file" : "Pin file"}
      detail={
        error ??
        (canWrite
          ? "Shared on this server's Files home"
          : "Requires file write access")
      }
      disabled={editorLoading || loading || pinning || !canWrite}
      onClick={() => setPinned(!pinned)}
    />
  )
}

function EditorDocument({
  editorRef,
  initialValue,
  preferencesStore,
  searchStore,
  sessionStore,
  ...props
}: Omit<
  React.ComponentProps<typeof SyntaxCodeEditor>,
  | "fontSize"
  | "onChange"
  | "onSearchOpenChange"
  | "originalValue"
  | "ref"
  | "searchOpen"
  | "searchQuery"
  | "showChanges"
  | "value"
  | "wrapLines"
> & {
  editorRef: React.RefObject<SyntaxCodeEditorHandle | null>
  initialValue: string
  preferencesStore: FileEditorPreferencesStore
  searchStore: EditorSearchStore
  sessionStore: EditorSessionStore
}) {
  const [value, setValue] = React.useState(initialValue)
  const fontSize = React.useSyncExternalStore(
    preferencesStore.subscribe,
    preferencesStore.getFontSizeSnapshot,
    preferencesStore.getFontSizeSnapshot
  )
  const originalValue = React.useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSavedValueSnapshot,
    sessionStore.getSavedValueSnapshot
  )
  const searchOpen = React.useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSearchOpenSnapshot,
    sessionStore.getSearchOpenSnapshot
  )
  const showChanges = React.useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getReviewChangesSnapshot,
    sessionStore.getReviewChangesSnapshot
  )
  const wrapLines = React.useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getWrapLinesSnapshot,
    sessionStore.getWrapLinesSnapshot
  )
  const searchQuery = React.useSyncExternalStore(
    searchStore.subscribe,
    searchStore.getSnapshot,
    searchStore.getSnapshot
  )

  const handleChange = React.useCallback(
    (nextValue: string) => {
      setValue(nextValue)
      sessionStore.setValue(nextValue)
    },
    [sessionStore]
  )

  return (
    <SyntaxCodeEditor
      ref={editorRef}
      {...props}
      fontSize={fontSize}
      onSearchOpenChange={sessionStore.setSearchOpen}
      originalValue={originalValue}
      searchOpen={searchOpen}
      searchQuery={searchQuery}
      showChanges={showChanges}
      value={value}
      wrapLines={wrapLines}
      onChange={handleChange}
    />
  )
}

const StableEditorDocument = React.memo(EditorDocument)

function EditorSearchContent({
  editorRef,
  inputRef,
  onClose,
  store,
}: {
  editorRef: React.RefObject<SyntaxCodeEditorHandle | null>
  inputRef: React.RefObject<HTMLInputElement | null>
  onClose: () => void
  store: EditorSearchStore
}) {
  const query = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  )

  return (
    <div className="flex items-center gap-1.5">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          aria-label="Find in file"
          className="h-8 bg-background/70 pr-2 pl-8 font-mono text-base shadow-none md:text-xs"
          placeholder="Find in file…"
          spellCheck={false}
          onChange={(event) => store.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            if (event.shiftKey) editorRef.current?.findPrevious()
            else editorRef.current?.findNext()
          }}
        />
      </div>
      <div className="flex shrink-0 items-center">
        <div className="flex h-10 w-9 flex-col gap-px">
          <button
            type="button"
            className="grid min-h-0 flex-1 place-items-center text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-ring/60 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35"
            aria-label="Previous match"
            disabled={!query}
            onClick={() => editorRef.current?.findPrevious()}
          >
            <ChevronUp className="size-[18px]" />
          </button>
          <button
            type="button"
            className="grid min-h-0 flex-1 place-items-center text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-ring/60 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35"
            aria-label="Next match"
            disabled={!query}
            onClick={() => editorRef.current?.findNext()}
          >
            <ChevronDown className="size-[18px]" />
          </button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Close file search"
          onClick={onClose}
        >
          <X className="size-[18px]" />
        </Button>
      </div>
    </div>
  )
}

function useFileSaveAction(
  file: RelayFileContent,
  instance: InstanceWorkspaceInstance
) {
  const queryClient = useQueryClient()
  const expectedModifiedAt = React.useRef(file.modifiedAt)
  React.useLayoutEffect(() => {
    expectedModifiedAt.current = file.modifiedAt
  }, [file.modifiedAt])
  const saveMutation = useMutation({
    mutationFn: saveRelayFile,
    onSuccess: async (nextFile, variables) => {
      expectedModifiedAt.current = nextFile.modifiedAt
      queryClient.setQueryData(
        queryKeys.relay.file(
          variables.data.relayId,
          variables.data.instanceId,
          variables.data.path
        ),
        nextFile
      )
      await queryClient.invalidateQueries({
        queryKey: queryKeys.relay.fileActivity(
          variables.data.relayId,
          variables.data.instanceId
        ),
      })
    },
  })
  const saveFile = saveMutation.mutateAsync

  return React.useCallback(
    async (content: string) => {
      await saveFile({
        data: {
          instanceId: instance.id,
          relayId: instance.relayId,
          path: file.path,
          content,
          expectedModifiedAt: expectedModifiedAt.current,
        },
      })
    },
    [file.path, instance.id, instance.relayId, saveFile]
  )
}

function EditorSaveButton({
  file,
  instance,
  loading,
  sessionStore,
}: {
  file: RelayFileContent
  instance: InstanceWorkspaceInstance
  loading: boolean
  sessionStore: EditorSessionStore
}) {
  const saveFile = useFileSaveAction(file, instance)
  const dirty = React.useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getDirtySnapshot,
    sessionStore.getDirtySnapshot
  )
  const saving = React.useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSavingSnapshot,
    sessionStore.getSavingSnapshot
  )

  async function handleSave() {
    sessionStore.setSaving(true)
    sessionStore.setSaveError(null)
    try {
      const value = sessionStore.getValue()
      await saveFile(value)
      sessionStore.markSaved(value)
    } catch (cause) {
      sessionStore.setSaveError(
        cause instanceof Error ? cause.message : "Save failed"
      )
    } finally {
      sessionStore.setSaving(false)
    }
  }

  return (
    <EditorTooltip
      content={
        file.readOnly
          ? "Read Only"
          : saving
            ? "Saving"
            : dirty
              ? "Save"
              : "Saved"
      }
    >
      <Button
        size="default"
        className={
          !dirty && !file.readOnly
            ? "gap-1.5 bg-primary/35 px-2.5 text-xs text-primary-foreground/65 shadow-none disabled:opacity-100"
            : "gap-1.5 px-2.5 text-xs shadow-none"
        }
        aria-label={
          file.readOnly
            ? "Archived log is read only"
            : dirty
              ? "Save changes"
              : "Changes saved"
        }
        disabled={!dirty || saving || loading || file.readOnly}
        onClick={handleSave}
      >
        {file.readOnly ? (
          <LockKeyhole className="size-[17px]" />
        ) : saving ? (
          <LoaderCircle className="size-[17px] animate-spin" />
        ) : (
          <Save className="size-[17px]" />
        )}
        <span>{file.readOnly ? "Read only" : saving ? "Saving" : "Save"}</span>
      </Button>
    </EditorTooltip>
  )
}

function EditorFontSizeButton({
  preferencesStore,
}: {
  preferencesStore: FileEditorPreferencesStore
}) {
  const [open, setOpen] = React.useState(false)
  const fontSize = React.useSyncExternalStore(
    preferencesStore.subscribe,
    preferencesStore.getFontSizeSnapshot,
    preferencesStore.getFontSizeSnapshot
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <EditorTooltip content="File Text Size">
        <PopoverTrigger asChild>
          <Button
            variant={open ? "secondary" : "ghost"}
            size="icon"
            aria-label={`File text size, ${fontSize} pixels`}
            aria-expanded={open}
          >
            <ALargeSmall className="size-[18px]" />
          </Button>
        </PopoverTrigger>
      </EditorTooltip>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={7}
        collisionPadding={12}
        className="w-[min(13rem,calc(100vw-1rem))] p-2.5"
      >
        <EditorFontSizeControl
          fontSize={fontSize}
          onFontSizeChange={preferencesStore.setFontSize}
        />
      </PopoverContent>
    </Popover>
  )
}

function EditorFontSizeControl({
  fontSize,
  onFontSizeChange,
}: {
  fontSize: number
  onFontSizeChange: (fontSize: number) => void
}) {
  const selectedIndex = Math.max(0, fileEditorFontSizes.indexOf(fontSize))

  return (
    <div className="flex items-center gap-2.5">
      <span className="w-3 shrink-0 text-left font-mono text-[9px] text-muted-foreground">
        A
      </span>
      <div className="relative min-w-0 flex-1 py-1.5">
        <div className="pointer-events-none absolute inset-x-2 top-1/2 grid -translate-y-1/2 grid-cols-4 gap-1">
          {fileEditorFontSizes.slice(1).map((size, index) => (
            <span
              key={size}
              className={`h-1 ${index < selectedIndex ? "bg-primary/75" : "bg-muted-foreground/25"}`}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={fileEditorFontSizes.length - 1}
          step={1}
          value={selectedIndex}
          aria-label="File text size"
          aria-valuetext={`${fontSize} pixels`}
          className="relative z-10 block h-5 w-full cursor-pointer appearance-none bg-transparent accent-primary [&::-moz-range-progress]:bg-transparent [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-none [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-primary [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:mt-[-6px] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm"
          onChange={(event) => {
            const nextFontSize = fileEditorFontSizes[event.target.valueAsNumber]
            if (nextFontSize !== undefined) onFontSizeChange(nextFontSize)
          }}
        />
      </div>
      <span className="w-3 shrink-0 text-right font-mono text-sm leading-none text-muted-foreground">
        A
      </span>
    </div>
  )
}

function FileActionMenuItem({
  active = false,
  icon,
  label,
  detail,
  disabled = false,
  onClick,
}: {
  active?: boolean
  icon: React.ReactNode
  label: string
  detail: string
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      className="group flex w-full items-center gap-2.5 border-t border-border/45 px-2 py-2 text-left transition-colors first:border-t-0 hover:bg-popover-accent/75 focus-visible:bg-popover-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
    >
      <span
        className={`grid size-7 shrink-0 place-items-center border transition-colors [&_svg]:size-3.5 ${active ? "border-primary/30 bg-primary/12 text-primary" : "border-border/60 bg-muted/20 text-muted-foreground group-hover:text-foreground"}`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-foreground">
          {label}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {detail}
        </span>
      </span>
      {active ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
    </button>
  )
}

function EditorTooltip({
  content,
  children,
}: {
  content: string
  children: React.ReactElement<{ disabled?: boolean }>
}) {
  const trigger = children.props.disabled ? (
    <span className="inline-flex max-w-full min-w-0">{children}</span>
  ) : (
    children
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

function FileTreePanel({
  instance,
  tree,
  selectionStore,
  refreshing,
  refreshDisabled,
  mobileOpen,
  onPathChange,
  onRefresh,
  onMobileOpenChange,
  onFileSelected,
  onHome,
  collapsed,
  animateCollapsedChange,
  onCollapsedChange,
  initialWidth,
  canWrite,
}: {
  instance: InstanceWorkspaceInstance
  tree: RelayFileTree
  selectionStore: FileSelectionStore
  refreshing: boolean
  refreshDisabled: boolean
  mobileOpen: boolean
  onPathChange: (path: string) => void
  onRefresh: () => void
  onMobileOpenChange: (open: boolean) => void
  onFileSelected: () => void
  onHome: () => void
  collapsed: boolean
  animateCollapsedChange: boolean
  onCollapsedChange: (collapsed: boolean) => void
  initialWidth: number | null
  canWrite: boolean
}) {
  const selectedPath = selectionStore.getSnapshot()
  const initialPath =
    selectedPath && tree.paths.includes(selectedPath) ? selectedPath : undefined
  const selectionHandlers = React.useRef({
    onFileSelected,
    onPathChange,
  })
  const previousTreePaths = React.useRef(tree.paths)
  const { model } = useFileTree({
    paths: tree.paths,
    initialExpansion: "closed",
    initialSelectedPaths: initialPath ? [initialPath] : [],
    onSelectionChange: (paths) => {
      const selected = paths.at(-1)
      const handlers = selectionHandlers.current
      if (
        !selected ||
        selected.endsWith("/") ||
        selected === selectionStore.getSnapshot()
      ) {
        return
      }
      handlers.onPathChange(selected)
      handlers.onFileSelected()
    },
    search: false,
    flattenEmptyDirectories: true,
    stickyFolders: true,
    itemHeight: 29,
    composition: { contextMenu: { enabled: true, triggerMode: "both" } },
    unsafeCSS: fileTreeLayoutCss,
  })
  const [mobileContentVisible, setMobileContentVisible] =
    React.useState(mobileOpen)
  const mobileBrowseButtonRef = React.useRef<HTMLButtonElement>(null)
  const panelRef = React.useRef<HTMLElement>(null)
  const resizeHandleRef = React.useRef<HTMLDivElement>(null)
  const resizeFrame = React.useRef<number | null>(null)
  const transitionOverflowTimer = React.useRef<number | null>(null)
  const pendingWidth = React.useRef<number | null>(null)
  const currentWidth = React.useRef(initialWidth ?? 304)
  const previousCollapsed = React.useRef(collapsed)
  const resizeSession = React.useRef<{
    pointerId: number
    startX: number
    startWidth: number
  } | null>(null)
  const previousDocumentStyles = React.useRef({
    userSelect: "",
  })
  const uploadInputRef = React.useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = React.useState(false)

  const handleFilesSelected = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = [...(event.target.files ?? [])]
      event.target.value = ""
      if (!files.length || !canWrite) return
      setUploading(true)
      let uploaded = 0
      try {
        const queue = [...files]
        let failure: unknown = null
        const uploadNext = async (): Promise<void> => {
          if (failure) return
          const file = queue.shift()
          if (!file) return
          try {
            await uploadRelayFile({
              file,
              instanceId: instance.id,
              path: file.name,
              relayId: instance.relayId,
            })
            uploaded += 1
            await uploadNext()
          } catch (cause) {
            failure ??= cause
          }
        }
        await Promise.all(
          Array.from({ length: Math.min(3, files.length) }, uploadNext)
        )
        if (failure) throw failure
        showToast({
          type: "success",
          message:
            uploaded === 1 ? "File uploaded" : `${uploaded} files uploaded`,
          description: "Transferred directly to the Relay instance root.",
        })
        onRefresh()
      } catch (cause) {
        showToast({
          type: "error",
          message: uploaded
            ? "Some files could not be uploaded"
            : "Upload failed",
          description:
            cause instanceof Error
              ? cause.message
              : "The Relay could not complete the upload.",
        })
        if (uploaded) onRefresh()
      } finally {
        setUploading(false)
      }
    },
    [canWrite, instance.id, instance.relayId, onRefresh]
  )

  function workspaceWidth() {
    return (
      panelRef.current?.parentElement?.getBoundingClientRect().width ??
      window.innerWidth
    )
  }

  function applyFileTreeWidth(width: number) {
    const nextWidth = clampFileTreeWidth(width, workspaceWidth())
    currentWidth.current = nextWidth
    panelRef.current?.style.setProperty("--file-tree-width", `${nextWidth}px`)
    const handle = resizeHandleRef.current
    if (handle) {
      handle.setAttribute("aria-valuenow", String(nextWidth))
      handle.setAttribute(
        "aria-valuemax",
        String(clampFileTreeWidth(fileTreeMaxWidth, workspaceWidth()))
      )
    }
    return nextWidth
  }

  function scheduleFileTreeWidth(width: number) {
    pendingWidth.current = width
    if (resizeFrame.current !== null) return
    resizeFrame.current = window.requestAnimationFrame(() => {
      resizeFrame.current = null
      const nextWidth = pendingWidth.current
      pendingWidth.current = null
      if (nextWidth !== null) applyFileTreeWidth(nextWidth)
    })
  }

  function restoreDocumentAfterResize() {
    document.documentElement.style.userSelect =
      previousDocumentStyles.current.userSelect
  }

  function finishPanelTransition() {
    if (transitionOverflowTimer.current !== null) {
      window.clearTimeout(transitionOverflowTimer.current)
      transitionOverflowTimer.current = null
    }
    panelRef.current?.style.removeProperty("overflow")
  }

  function finishResize(pointerId?: number) {
    if (
      pointerId !== undefined &&
      resizeSession.current?.pointerId !== pointerId
    ) {
      return
    }
    if (resizeFrame.current !== null) {
      window.cancelAnimationFrame(resizeFrame.current)
      resizeFrame.current = null
    }
    if (pendingWidth.current !== null) {
      applyFileTreeWidth(pendingWidth.current)
      pendingWidth.current = null
    }
    resizeSession.current = null
    panelRef.current?.removeAttribute("data-resizing")
    panelRef.current?.style.removeProperty("transition")
    resizeHandleRef.current?.removeAttribute("data-resizing")
    restoreDocumentAfterResize()
    persistFileTreeWidth(currentWidth.current)
  }

  React.useLayoutEffect(() => {
    applyFileTreeWidth(initialWidth ?? defaultFileTreeWidth())
  }, [initialWidth])

  React.useLayoutEffect(() => {
    selectionHandlers.current = {
      onFileSelected,
      onPathChange,
    }
  }, [onFileSelected, onPathChange])

  React.useLayoutEffect(() => {
    if (previousTreePaths.current === tree.paths) return
    previousTreePaths.current = tree.paths
    model.resetPaths(tree.paths, { initialExpandedPaths: [] })
  }, [model, tree.paths])

  React.useLayoutEffect(() => {
    if (mobileOpen) {
      setMobileContentVisible(true)
      return
    }
    const timer = window.setTimeout(
      () => setMobileContentVisible(false),
      mobileFileDrawerTransitionMs
    )
    return () => window.clearTimeout(timer)
  }, [mobileOpen])

  React.useLayoutEffect(() => {
    if (!collapsed) applyFileTreeWidth(currentWidth.current)
  }, [collapsed])

  React.useLayoutEffect(() => {
    const panel = panelRef.current
    const changed = previousCollapsed.current !== collapsed
    previousCollapsed.current = collapsed
    if (!panel || !changed || !window.matchMedia("(min-width: 768px)").matches)
      return
    if (!animateCollapsedChange) {
      finishPanelTransition()
      return
    }

    panel.style.overflow = "hidden"
    if (transitionOverflowTimer.current !== null) {
      window.clearTimeout(transitionOverflowTimer.current)
    }
    transitionOverflowTimer.current = window.setTimeout(
      finishPanelTransition,
      240
    )
  }, [animateCollapsedChange, collapsed])

  React.useEffect(
    () => () => {
      if (resizeFrame.current !== null) {
        window.cancelAnimationFrame(resizeFrame.current)
      }
      if (transitionOverflowTimer.current !== null) {
        window.clearTimeout(transitionOverflowTimer.current)
      }
      if (resizeSession.current) restoreDocumentAfterResize()
    },
    []
  )

  function handleResizePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const panel = panelRef.current
    if (!panel) return
    resizeSession.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: panel.getBoundingClientRect().width,
    }
    previousDocumentStyles.current = {
      userSelect: document.documentElement.style.userSelect,
    }
    document.documentElement.style.userSelect = "none"
    panel.dataset.resizing = "true"
    panel.style.transition = "none"
    event.currentTarget.dataset.resizing = "true"
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is progressive enhancement; pointer events still work.
    }
  }

  function handleResizePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const session = resizeSession.current
    if (!session || session.pointerId !== event.pointerId) return
    scheduleFileTreeWidth(session.startWidth + event.clientX - session.startX)
  }

  function handleResizePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (resizeSession.current?.pointerId !== event.pointerId) return
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // The pointer may already have been released by the browser.
    }
    finishResize(event.pointerId)
  }

  function handleResizeKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 32 : 16
    let nextWidth: number | null = null
    if (event.key === "ArrowLeft") nextWidth = currentWidth.current - step
    if (event.key === "ArrowRight") nextWidth = currentWidth.current + step
    if (event.key === "Home") nextWidth = fileTreeMinWidth
    if (event.key === "End") nextWidth = fileTreeMaxWidth
    if (nextWidth === null) return
    event.preventDefault()
    persistFileTreeWidth(applyFileTreeWidth(nextWidth))
  }

  function handleHomeClick() {
    onMobileOpenChange(false)
    onHome()
  }

  function closeMobileFileBrowser() {
    onMobileOpenChange(false)
    window.requestAnimationFrame(() => mobileBrowseButtonRef.current?.focus())
  }

  return (
    <aside
      ref={panelRef}
      id={`file-tree-${instance.shortId}`}
      data-file-tree-panel
      data-mobile-file-drawer
      data-state={mobileOpen ? "open" : "closed"}
      data-collapsed={collapsed}
      className={`absolute inset-x-0 bottom-0 z-30 flex w-full shrink-0 flex-col overflow-hidden border-t border-border/80 bg-card shadow-[0_-18px_45px_rgba(0,0,0,0.35)] transition-[height] duration-200 ease-out md:relative md:inset-auto md:z-auto md:h-auto md:min-h-0 md:border-t-0 md:shadow-none ${animateCollapsedChange ? "md:transition-[width,min-width,max-width] md:duration-200 md:ease-linear" : "md:transition-none"} ${collapsed ? "md:!w-0 md:!max-w-0 md:!min-w-0 md:overflow-hidden" : "md:w-[var(--file-tree-width)] md:max-w-[45%] md:min-w-56 md:overflow-visible md:[--file-tree-width:17.5rem] xl:max-w-[30rem] xl:[--file-tree-width:19rem]"} ${mobileOpen ? "h-full" : "h-11"}`}
      onTransitionEnd={(event) => {
        if (event.currentTarget !== event.target) return
        if (
          event.propertyName === "width" ||
          event.propertyName === "min-width" ||
          event.propertyName === "max-width"
        ) {
          finishPanelTransition()
        }
      }}
      style={
        initialWidth
          ? ({
              "--file-tree-width": `${initialWidth}px`,
            } as React.CSSProperties)
          : undefined
      }
    >
      <div
        className={`${mobileContentVisible ? "flex" : "hidden"} order-1 h-12 shrink-0 items-center border-b border-border/80 bg-card px-3 md:hidden`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <FolderTree className="size-[18px] shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Browse files</p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              /data
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close file browser"
          onClick={closeMobileFileBrowser}
        >
          <X className="size-[18px]" />
        </Button>
      </div>

      <div
        className={`absolute inset-x-0 bottom-0 z-10 order-2 flex h-11 shrink-0 items-center overflow-hidden border-t bg-card px-1.5 md:relative md:inset-auto md:z-auto md:order-1 md:h-14 md:w-[var(--file-tree-width)] md:border-t-0 md:border-b md:px-2 ${collapsed ? "md:invisible" : ""}`}
      >
        <FileTreeHomeButton
          selectionStore={selectionStore}
          onClick={handleHomeClick}
        />
        <Button
          ref={mobileBrowseButtonRef}
          variant={mobileOpen ? "secondary" : "ghost"}
          size="icon-sm"
          className="shrink-0 shadow-none md:hidden"
          aria-label="Browse files"
          aria-controls={`file-tree-${instance.shortId}`}
          aria-expanded={mobileOpen}
          onClick={() => onMobileOpenChange(!mobileOpen)}
        >
          <FolderTree className="size-[18px]" />
        </Button>
        <FileTreeSearchInput
          model={model}
          onMobileOpenChange={onMobileOpenChange}
          onMobileClose={closeMobileFileBrowser}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="New"
                title="New…"
              >
                <Plus className="size-[18px]" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="bottom"
              sideOffset={6}
              className="w-56 p-1"
            >
              <p className="border-b px-2 py-2 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Add to instance
              </p>
              <FileActionPreview icon={<FolderPlus />} label="New directory" />
              <FileActionPreview icon={<FilePlus />} label="New file" />
              <button
                type="button"
                disabled={!canWrite || uploading || refreshDisabled}
                className="flex w-full items-center gap-2.5 px-2 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-popover-accent/75 hover:text-foreground focus-visible:bg-popover-accent focus-visible:text-foreground focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
                onClick={() => uploadInputRef.current?.click()}
              >
                <span className="grid size-7 shrink-0 place-items-center border border-border/70 bg-card [&>svg]:size-3.5">
                  {uploading ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Upload />
                  )}
                </span>
                <span className="min-w-0 flex-1 text-foreground">
                  {uploading ? "Uploading…" : "Upload files"}
                </span>
                <span className="font-mono text-[8px] tracking-wider text-primary uppercase">
                  Direct
                </span>
              </button>
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                className="hidden"
                aria-label="Choose files to upload"
                onChange={(event) => void handleFilesSelected(event)}
              />
              <FileActionPreview icon={<Network />} label="Connect with SFTP" />
            </PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              {refreshing ? (
                <span className="inline-flex">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Refreshing files"
                    disabled
                  >
                    <RefreshCw className="size-[18px] animate-spin" />
                  </Button>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Refresh files"
                  disabled={refreshDisabled}
                  onClick={onRefresh}
                >
                  <RefreshCw className="size-[18px]" />
                </Button>
              )}
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {refreshing
                ? "Refreshing Files"
                : refreshDisabled
                  ? "Relay disconnected"
                  : "Refresh Files"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="hidden md:inline-flex"
                aria-label="Collapse file tree"
                aria-controls={`file-tree-${instance.shortId}`}
                onClick={() => onCollapsedChange(true)}
              >
                <PanelLeftClose className="size-[18px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              Collapse File Tree
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div
        className={`order-1 mb-11 min-h-0 flex-1 overflow-hidden bg-card py-1.5 md:order-2 md:mb-0 md:block md:w-[var(--file-tree-width)] md:shrink-0 ${mobileContentVisible ? "block" : "hidden"} ${collapsed ? "md:invisible" : ""}`}
      >
        <FileTreeSelectionSync model={model} selectionStore={selectionStore} />
        <FileTree
          model={model}
          aria-label={`${instance.name} files`}
          className="block size-full min-h-[210px]"
          style={
            {
              "--trees-selected-bg-override":
                "color-mix(in oklch, var(--primary) 20%, transparent)",
              "--trees-selected-fg-override": "var(--foreground)",
              "--trees-bg-override": "var(--card)",
              "--trees-bg-muted-override": "var(--muted)",
              "--trees-fg-override": "var(--foreground)",
              "--trees-fg-muted-override": "var(--muted-foreground)",
              "--trees-input-bg-override": "var(--background)",
              "--trees-search-bg-override": "var(--background)",
              "--trees-search-fg-override": "var(--foreground)",
              "--trees-border-color-override": "var(--border)",
              "--trees-border-radius-override": "0px",
              "--trees-font-family-override": "'Archivo Variable', sans-serif",
              "--trees-font-size-override": "12px",
              "--trees-padding-inline-override": "0px",
              "--trees-item-padding-x-override": "5px",
              "--trees-item-margin-x-override": "0px",
              "--trees-item-row-gap-override": "4px",
              "--trees-level-gap-override": "4px",
              "--trees-context-menu-trigger-inline-offset": "8px",
              height: "100%",
            } as React.CSSProperties
          }
          renderContextMenu={(item) => (
            <div
              className={`${floatingSurfaceClassName} absolute top-full right-0 z-[100] min-w-36 border border-border/90 p-1 text-xs`}
            >
              <button
                type="button"
                className="flex w-full px-2 py-1.5 hover:bg-popover-accent"
              >
                Open {item.path}
              </button>
              <button
                type="button"
                className="flex w-full px-2 py-1.5 hover:bg-popover-accent"
              >
                Rename
              </button>
              <button
                type="button"
                className="flex w-full px-2 py-1.5 text-destructive hover:bg-destructive/10"
              >
                Delete
              </button>
            </div>
          )}
        />
      </div>

      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 z-30 hidden w-px bg-border/80 md:block"
      />

      <div
        ref={resizeHandleRef}
        role="separator"
        tabIndex={0}
        aria-label="Resize file tree"
        aria-orientation="vertical"
        aria-valuemin={fileTreeMinWidth}
        aria-valuemax={fileTreeMaxWidth}
        aria-valuenow={currentWidth.current}
        className={`${collapsed ? "md:hidden" : "md:flex"} group absolute inset-y-0 -right-1 z-40 hidden w-2.5 cursor-col-resize touch-none items-center justify-center outline-none`}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd}
        onPointerCancel={handleResizePointerEnd}
        onLostPointerCapture={() => {
          if (resizeSession.current) finishResize()
        }}
        onDoubleClick={(event) => {
          event.preventDefault()
          persistFileTreeWidth(applyFileTreeWidth(defaultFileTreeWidth()))
        }}
        onKeyDown={handleResizeKeyDown}
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80 transition-colors group-hover:bg-primary/55 group-focus-visible:bg-primary/75 group-data-[resizing=true]:bg-primary" />
        <span className="relative grid h-9 w-2.5 place-items-center overflow-hidden border border-primary/35 bg-background text-primary opacity-0 shadow-[0_0_14px_color-mix(in_oklch,var(--primary),transparent_70%)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[resizing=true]:opacity-100">
          <GripVertical className="size-2" />
        </span>
      </div>
    </aside>
  )
}

function FileTreeHomeButton({
  selectionStore,
  onClick,
}: {
  selectionStore: FileSelectionStore
  onClick: () => void
}) {
  const isHome = React.useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getIsHomeSnapshot,
    selectionStore.getIsHomeSnapshot
  )
  return <FilesHomeButton active={isHome} onClick={onClick} />
}

function FileTreeSearchInput({
  model,
  onMobileOpenChange,
  onMobileClose,
}: {
  model: ReturnType<typeof useFileTree>["model"]
  onMobileOpenChange: (open: boolean) => void
  onMobileClose: () => void
}) {
  const search = useFileTreeSearch(model)

  return (
    <label className="flex h-full min-w-0 flex-1 items-center">
      <Search className="ml-1 size-[18px] shrink-0 text-foreground/90 md:ml-1.5" />
      <input
        type="search"
        value={search.value}
        placeholder="Search files…"
        aria-label="Search instance files"
        className="h-full min-w-0 flex-1 bg-transparent px-2 text-base text-foreground outline-none placeholder:text-muted-foreground/70 md:text-sm"
        onChange={(event) => {
          const value = event.target.value
          if (value) search.setValue(value)
          else search.close()
        }}
        onFocus={() => {
          if (window.matchMedia("(max-width: 767px)").matches) {
            onMobileOpenChange(true)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            if (search.value) search.close()
            else onMobileClose()
            return
          }
          if (event.key === "Enter") {
            event.preventDefault()
            if (event.shiftKey) search.focusPreviousMatch()
            else search.focusNextMatch()
          }
        }}
      />
    </label>
  )
}

function FileTreeSelectionSync({
  model,
  selectionStore,
}: {
  model: ReturnType<typeof useFileTree>["model"]
  selectionStore: FileSelectionStore
}) {
  const selectedPath = React.useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSnapshot,
    selectionStore.getSnapshot
  )

  React.useLayoutEffect(() => {
    const currentSelection = model.getSelectedPaths()
    if (selectedPath) {
      if (
        currentSelection.length !== 1 ||
        currentSelection[0] !== selectedPath
      ) {
        for (const path of currentSelection) model.getItem(path)?.deselect()
        model.getItem(selectedPath)?.select()
      }
      return
    }
    for (const path of currentSelection) model.getItem(path)?.deselect()
  }, [model, selectedPath])

  return null
}

function FileActionPreview({
  icon,
  label,
}: {
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      disabled
      className="flex w-full items-center gap-2.5 px-2 py-2 text-left text-xs text-muted-foreground/80 transition-colors hover:bg-popover-accent/75 hover:text-foreground focus-visible:bg-popover-accent focus-visible:text-foreground focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted-foreground/80"
    >
      <span className="grid size-7 shrink-0 place-items-center border border-border/70 bg-card [&>svg]:size-3.5">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-foreground/75">{label}</span>
      <span className="font-mono text-[8px] tracking-wider text-muted-foreground/60 uppercase">
        Soon
      </span>
    </button>
  )
}

function fileActivityKind(entry: RelayFileActivityEntry): "Edited" | "Viewed" {
  if (
    entry.lastEditedAt &&
    new Date(entry.lastEditedAt).getTime() >=
      new Date(entry.lastViewedAt).getTime()
  ) {
    return "Edited"
  }
  return "Viewed"
}

function fileActivityTime(entry: RelayFileActivityEntry): string {
  const latest = entry.lastEditedAt
    ? Math.max(
        new Date(entry.lastViewedAt).getTime(),
        new Date(entry.lastEditedAt).getTime()
      )
    : new Date(entry.lastViewedAt).getTime()
  const elapsed = Math.max(0, Date.now() - latest)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (elapsed < minute) return "just now"
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m ago`
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h ago`
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)}d ago`
  const activityDate = new Date(latest)
  const currentDate = new Date()
  return (
    activityDate.getFullYear() === currentDate.getFullYear()
      ? recentFileDateFormatter
      : olderFileDateFormatter
  ).format(activityDate)
}

function FileActivityRow({
  entry,
  onOpen,
}: {
  entry: RelayFileActivityEntry
  onOpen: (path: string) => void
}) {
  const kind = fileActivityKind(entry)
  return (
    <button
      type="button"
      className="group grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-border/55 px-2 py-3 text-left transition-colors first:border-t-0 hover:bg-accent/35 focus-visible:bg-accent/45 focus-visible:outline-none sm:px-3"
      onClick={() => onOpen(entry.path)}
    >
      <span className="grid size-8 place-items-center border border-border/70 bg-muted/20 text-muted-foreground transition-colors group-hover:border-primary/25 group-hover:text-primary">
        <FileCode2 className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">
          {formatName(entry.path)}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
          /data/{entry.path}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 pl-2 text-[10px] text-muted-foreground">
        <span>
          {kind}{" "}
          <time
            dateTime={
              kind === "Edited"
                ? (entry.lastEditedAt ?? entry.lastViewedAt)
                : entry.lastViewedAt
            }
            suppressHydrationWarning
          >
            {fileActivityTime(entry)}
          </time>
        </span>
        {entry.pinned ? (
          <Pin
            className="size-3.5 fill-primary/15 text-primary"
            aria-label="Pinned"
          />
        ) : null}
      </span>
    </button>
  )
}

function FilesHome({
  instance,
  tree,
  fileTreeLoading,
  fileTreeError,
  treeCollapsed,
  onTreeExpand,
  onOpen,
}: {
  instance: InstanceWorkspaceInstance
  tree: RelayFileTree | null
  fileTreeLoading: boolean
  fileTreeError: string | null
  treeCollapsed: boolean
  onTreeExpand: () => void
  onOpen: (path: string) => void
}) {
  const activityQuery = useQuery(
    relayFileActivityQueryOptions(instance.relayId, instance.id)
  )
  const activity = React.useMemo(() => {
    if (!tree || !activityQuery.data) return []
    const availablePaths = new Set(tree.paths)
    return activityQuery.data.files.filter((entry) =>
      availablePaths.has(entry.path)
    )
  }, [activityQuery.data, tree])
  const loading = fileTreeLoading || activityQuery.isFetching
  const error =
    fileTreeError ??
    queryErrorMessage(activityQuery.error, "Could not load recent files")
  const pinned = activity.filter((entry) => entry.pinned)
  const recent = activity.filter((entry) => !entry.pinned)
  const empty = pinned.length === 0 && recent.length === 0

  return (
    <section className="flex min-h-[360px] min-w-0 flex-1 flex-col bg-card">
      <div className={fileEditorHeaderClassName}>
        {treeCollapsed ? <FileTreeRevealButton onClick={onTreeExpand} /> : null}
        <div className={fileEditorHeaderContentClassName}>
          <div className="flex min-w-0 flex-1 items-center gap-2.5 md:gap-3">
            <Clock3 className="size-5 shrink-0 text-primary" />
            <p className="truncate text-sm font-semibold">Files</p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-3xl">
          {loading ? (
            <div className="grid min-h-44 place-items-center border border-border/70 bg-muted/5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin text-primary" />
                Loading file activity
              </div>
            </div>
          ) : null}

          {!loading && error ? (
            <div className="border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          {!loading && !error && empty ? (
            <div className="grid min-h-52 place-items-center border border-dashed border-border/80 bg-muted/5 px-6 text-center">
              <div className="max-w-sm">
                <div className="mx-auto grid size-10 place-items-center border border-border/70 bg-card text-muted-foreground">
                  <Clock3 className="size-[18px]" />
                </div>
                <p className="mt-4 text-sm font-semibold">
                  No recent files yet
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Open a file from the tree and it will appear here for everyone
                  with access to this server.
                </p>
              </div>
            </div>
          ) : null}

          {!loading && !error && pinned.length > 0 ? (
            <div className="mb-7">
              <div className="mb-2 flex items-center gap-2 px-1">
                <Pin className="size-3.5 text-primary" />
                <h2 className="font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  Pinned
                </h2>
              </div>
              <div className="border border-border/75 bg-muted/5">
                {pinned.map((entry) => (
                  <FileActivityRow
                    key={entry.path}
                    entry={entry}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {!loading && !error && recent.length > 0 ? (
            <div>
              <div className="mb-2 flex items-center gap-2 px-1">
                <Clock3 className="size-3.5 text-primary" />
                <h2 className="font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  Recent
                </h2>
              </div>
              <div className="border border-border/75 bg-muted/5">
                {recent.map((entry) => (
                  <FileActivityRow
                    key={entry.path}
                    entry={entry}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

const UnavailablePreviewToolbar = React.memo(
  function UnavailablePreviewToolbar({
    path,
    pathIsCopyable,
    canShare,
    treeCollapsed,
    onTreeExpand,
  }: {
    path: string
    pathIsCopyable: boolean
    canShare: boolean
    treeCollapsed: boolean
    onTreeExpand: () => void
  }) {
    return (
      <div className={fileEditorHeaderClassName} data-file-toolbar>
        {treeCollapsed ? <FileTreeRevealButton onClick={onTreeExpand} /> : null}
        <div className={fileEditorHeaderContentClassName}>
          <FileToolbarIdentity path={path} pathIsCopyable={pathIsCopyable} />

          <div
            className="ml-auto hidden max-w-full min-w-0 flex-wrap items-center justify-end gap-1 md:flex"
            aria-hidden="true"
          >
            {canShare ? (
              <span className="h-8 w-[5.5rem] animate-pulse bg-muted/35" />
            ) : null}
            {Array.from({ length: 5 }, (_, index) => (
              <span key={index} className="size-8 animate-pulse bg-muted/35" />
            ))}
          </div>

          <div
            className="ml-auto flex shrink-0 items-center gap-1 md:hidden"
            aria-hidden="true"
          >
            <span className="size-8 animate-pulse bg-muted/35" />
            <span className="size-8 animate-pulse bg-muted/35" />
          </div>
        </div>
      </div>
    )
  }
)

function UnavailablePreview({
  path,
  pathIsCopyable,
  loading,
  message,
  canShare,
  treeCollapsed,
  onTreeExpand,
}: {
  path: string
  pathIsCopyable: boolean
  loading: boolean
  message: string | null
  canShare: boolean
  treeCollapsed: boolean
  onTreeExpand: () => void
}) {
  return (
    <section
      className="flex min-h-[360px] min-w-0 flex-1 flex-col bg-card"
      aria-busy={loading}
    >
      <UnavailablePreviewToolbar
        path={path}
        pathIsCopyable={pathIsCopyable}
        canShare={canShare}
        treeCollapsed={treeCollapsed}
        onTreeExpand={onTreeExpand}
      />
      {loading ? (
        <div className="flex min-h-0 flex-1">
          <div
            className="w-[var(--file-editor-gutter-width,3rem)] shrink-0 border-r border-border/80 bg-muted/10"
            data-file-editor-loading-rail
            aria-hidden="true"
          />
          <div className="grid min-w-0 flex-1 place-items-center px-6 text-center">
            <FileWorkspaceLoadingState
              title="Reading from Relay"
              description="Checking the file and preparing a safe text preview."
            />
          </div>
        </div>
      ) : (
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div className="max-w-xs">
            <div className="mx-auto mb-4 grid size-11 place-items-center rounded-xl border bg-muted/20 text-muted-foreground">
              <HardDriveDownload className="size-5" />
            </div>
            <p className="text-sm font-semibold">Preview unavailable</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {message || "This file cannot be displayed as text."}
            </p>
          </div>
        </div>
      )}
    </section>
  )
}

const StableEditor = React.memo(Editor)
const StableFileTreePanel = React.memo(FileTreePanel)

interface FileWorkspaceProps {
  instance: InstanceWorkspaceInstance
  active: boolean
  routeFilePath?: string
  canShare: boolean
  canWrite: boolean
  relayConnected: boolean
  openTreeOnEntry: boolean
  initialTreeCollapsed: boolean
  initialTreeWidth: number | null
}

export function FileWorkspace(props: FileWorkspaceProps) {
  const normalizedRoutePath = props.routeFilePath?.replace(/^\/+/, "") ?? ""
  const [selectionStore] = React.useState(() =>
    createFileSelectionStore(normalizedRoutePath)
  )
  const lastRoutedPath = React.useRef(normalizedRoutePath)
  const router = useRouter()

  React.useLayoutEffect(() => {
    if (lastRoutedPath.current === normalizedRoutePath) return
    lastRoutedPath.current = normalizedRoutePath
    selectionStore.select(normalizedRoutePath)
  }, [normalizedRoutePath, selectionStore])

  React.useEffect(
    () => () => selectionStore.cancelNavigation(),
    [selectionStore]
  )

  const handlePathChange = React.useCallback(
    (path: string) => {
      const currentPath = selectionStore.getSnapshot()
      if (currentPath === path) return

      const nextLocation = router.buildLocation({
        to: "/server/$serverId/files/$",
        params: { serverId: props.instance.routeId, _splat: path },
      })
      const nextUrl = new URL(nextLocation.href, window.location.href).href
      selectionStore.navigate(path, window.location.href, nextUrl)
      if (!props.active) return

      void router.navigate({
        to: "/server/$serverId/files/$",
        params: { serverId: props.instance.routeId, _splat: path },
        replace: true,
        resetScroll: false,
      })
    },
    [props.active, props.instance.routeId, router, selectionStore]
  )

  return (
    <StableFileWorkspaceSurface
      instance={props.instance}
      selectionStore={selectionStore}
      canShare={props.canShare}
      canWrite={props.canWrite}
      relayConnected={props.relayConnected}
      onPathChange={handlePathChange}
      openTreeOnEntry={props.openTreeOnEntry}
      initialTreeCollapsed={props.initialTreeCollapsed}
      initialTreeWidth={props.initialTreeWidth}
    />
  )
}

interface FileWorkspaceSurfaceProps {
  instance: InstanceWorkspaceInstance
  selectionStore: FileSelectionStore
  canShare: boolean
  canWrite: boolean
  relayConnected: boolean
  onPathChange: (path: string) => void
  openTreeOnEntry: boolean
  initialTreeCollapsed: boolean
  initialTreeWidth: number | null
}

const StableFileWorkspaceSurface = React.memo(function FileWorkspaceSurface({
  instance,
  selectionStore,
  canShare,
  canWrite,
  relayConnected,
  onPathChange,
  openTreeOnEntry,
  initialTreeCollapsed,
  initialTreeWidth,
}: FileWorkspaceSurfaceProps) {
  const queryClient = useQueryClient()
  const [preferencesStore] = React.useState(createFileEditorPreferencesStore)
  const [mobileTreeOpen, setMobileTreeOpen] = React.useState(false)
  const [treeCollapsed, setTreeCollapsed] = React.useState(
    initialTreeCollapsed && !openTreeOnEntry
  )
  const [treeTransitionSuppressed, setTreeTransitionSuppressed] =
    React.useState(openTreeOnEntry)
  const handledTreeEntry = React.useRef(false)
  const openingTreeForRouteEntry = openTreeOnEntry && !handledTreeEntry.current
  const displayedTreeCollapsed = treeCollapsed && !openingTreeForRouteEntry
  const treeQuery = useQuery(
    relayTreeQueryOptions(instance.relayId, instance.id)
  )
  const tree = treeQuery.data ?? null
  const refreshTreeMutation = useMutation({
    mutationFn: () =>
      getRelayTree({
        data: {
          instanceId: instance.id,
          relayId: instance.relayId,
          fresh: true,
        },
      }),
    onSuccess: (nextTree) => {
      queryClient.setQueryData(
        queryKeys.relay.tree(instance.relayId, instance.id),
        nextTree
      )
    },
  })

  React.useEffect(() => preferencesStore.hydrate(), [preferencesStore])

  const handleTreeCollapsedChange = React.useCallback(
    (nextCollapsed: boolean) => {
      setTreeCollapsed(nextCollapsed)
      document.cookie = `${fileTreeCollapsedCookieName}=${nextCollapsed}; path=/; max-age=${fileTreeCookieMaxAge}; SameSite=Lax`
    },
    []
  )
  const handleTreeExpand = React.useCallback(
    () => handleTreeCollapsedChange(false),
    [handleTreeCollapsedChange]
  )

  React.useLayoutEffect(() => {
    if (!openTreeOnEntry) {
      handledTreeEntry.current = false
      return
    }
    if (handledTreeEntry.current) return
    handledTreeEntry.current = true
    setTreeTransitionSuppressed(true)
    handleTreeCollapsedChange(false)
  }, [handleTreeCollapsedChange, openTreeOnEntry])

  React.useEffect(() => {
    if (!treeTransitionSuppressed) return
    let secondFrame: number | null = null
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setTreeTransitionSuppressed(false)
      })
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame)
    }
  }, [treeTransitionSuppressed])

  const handleHome = React.useCallback(() => {
    onPathChange("")
  }, [onPathChange])

  const closeMobileTree = React.useCallback(() => {
    setMobileTreeOpen(false)
  }, [])

  const refreshTree = refreshTreeMutation.mutate
  const handleRefresh = React.useCallback(() => {
    refreshTree()
  }, [refreshTree])

  return (
    <div
      className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden md:flex-row"
      data-file-workspace
    >
      {tree ? (
        <StableFileTreePanel
          key={instance.id}
          instance={instance}
          tree={tree}
          selectionStore={selectionStore}
          refreshing={refreshTreeMutation.isPending}
          refreshDisabled={!relayConnected}
          mobileOpen={mobileTreeOpen}
          onPathChange={onPathChange}
          onRefresh={handleRefresh}
          onMobileOpenChange={setMobileTreeOpen}
          onFileSelected={closeMobileTree}
          onHome={handleHome}
          collapsed={displayedTreeCollapsed}
          animateCollapsedChange={
            !openingTreeForRouteEntry && !treeTransitionSuppressed
          }
          onCollapsedChange={handleTreeCollapsedChange}
          initialWidth={initialTreeWidth}
          canWrite={canWrite}
        />
      ) : (
        <FileTreeLoadingPanel
          collapsed={displayedTreeCollapsed}
          width={initialTreeWidth}
        />
      )}
      <div className="relative flex min-h-0 min-w-0 flex-1 pb-11 md:pb-0">
        <FileViewer
          canShare={canShare && relayConnected}
          canWrite={canWrite && relayConnected}
          fileTreeError={
            queryErrorMessage(treeQuery.error, "Could not load files") ??
            queryErrorMessage(
              refreshTreeMutation.error,
              "Could not refresh files"
            )
          }
          fileTreeLoading={treeQuery.isPending}
          instance={instance}
          onPathChange={onPathChange}
          onTreeExpand={handleTreeExpand}
          preferencesStore={preferencesStore}
          selectionStore={selectionStore}
          tree={tree}
          treeCollapsed={displayedTreeCollapsed}
          relayConnected={relayConnected}
        />
      </div>
    </div>
  )
})

interface FileViewerProps {
  canShare: boolean
  canWrite: boolean
  fileTreeError: string | null
  fileTreeLoading: boolean
  instance: InstanceWorkspaceInstance
  onPathChange: (path: string) => void
  onTreeExpand: () => void
  preferencesStore: FileEditorPreferencesStore
  selectionStore: FileSelectionStore
  tree: RelayFileTree | null
  treeCollapsed: boolean
  relayConnected: boolean
}

function FileViewer({
  canShare,
  canWrite,
  fileTreeError,
  fileTreeLoading,
  instance,
  onPathChange,
  onTreeExpand,
  preferencesStore,
  selectionStore,
  tree,
  treeCollapsed,
  relayConnected,
}: FileViewerProps) {
  const queryClient = useQueryClient()
  const selectedPath = React.useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSnapshot,
    selectionStore.getSnapshot
  )
  const isHome = !selectedPath
  const selectedPathIsReadable = Boolean(
    tree?.paths.includes(selectedPath) && !selectedPath.endsWith("/")
  )
  const fileQuery = useQuery({
    ...relayFileQueryOptions(instance.relayId, instance.id, selectedPath),
    enabled: selectedPathIsReadable && relayConnected,
    refetchOnMount: "always",
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  const file = fileQuery.data?.path === selectedPath ? fileQuery.data : null
  const loadingFile =
    fileTreeLoading || (selectedPathIsReadable && fileQuery.isFetching)
  const routeError =
    tree &&
    selectedPath &&
    (!tree.paths.includes(selectedPath) || selectedPath.endsWith("/"))
      ? `Could not find /data/${selectedPath}`
      : null
  const error =
    routeError ??
    fileTreeError ??
    (selectedPath && !relayConnected
      ? file
        ? "Relay disconnected. Showing a cached read-only copy."
        : "Unable to connect to Relay. This file is not cached."
      : null) ??
    queryErrorMessage(fileQuery.error, "Could not read file")
  const selectedFileUnavailable =
    Boolean(tree && selectedPath && !selectedPathIsReadable) ||
    (selectedPathIsReadable && !file && (!relayConnected || fileQuery.isError))
  const activitySyncKey = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!fileQuery.data || fileQuery.data.path !== selectedPath) return
    const nextKey = `${fileQuery.data.path}:${fileQuery.data.modifiedAt}`
    if (activitySyncKey.current === nextKey) return
    activitySyncKey.current = nextKey
    void queryClient.invalidateQueries({
      queryKey: queryKeys.relay.fileActivity(instance.relayId, instance.id),
      // Avoid refetching the active pin-only observer. Files Home mounts its
      // own observer and refetches this stale query when it opens.
      refetchType: "none",
    })
  }, [fileQuery.data, instance.id, instance.relayId, queryClient, selectedPath])

  React.useEffect(() => {
    if (isHome) {
      selectionStore.completeNavigation(selectedPath, "loaded")
      return
    }
    if (loadingFile) return
    selectionStore.completeNavigation(
      selectedPath,
      file && !selectedFileUnavailable ? "loaded" : "unavailable"
    )
  }, [
    file,
    isHome,
    loadingFile,
    selectedFileUnavailable,
    selectedPath,
    selectionStore,
  ])

  if (isHome) {
    return (
      <FilesHome
        instance={instance}
        tree={tree}
        fileTreeLoading={fileTreeLoading}
        fileTreeError={fileTreeError}
        treeCollapsed={treeCollapsed}
        onTreeExpand={onTreeExpand}
        onOpen={onPathChange}
      />
    )
  }

  if (file && !selectedFileUnavailable && !loadingFile) {
    return (
      <StableEditor
        key={`${file.instanceId}:${file.path}`}
        canShare={canShare}
        canWrite={canWrite}
        file={file}
        displayPath={selectedPath}
        instance={instance}
        loading={false}
        error={error}
        preferencesStore={preferencesStore}
        treeCollapsed={treeCollapsed}
        onTreeExpand={onTreeExpand}
      />
    )
  }

  return (
    <UnavailablePreview
      path={selectedPath || instance.name}
      pathIsCopyable={Boolean(selectedPath)}
      loading={loadingFile}
      message={error}
      canShare={canShare}
      treeCollapsed={treeCollapsed}
      onTreeExpand={onTreeExpand}
    />
  )
}

function queryErrorMessage(error: Error | null, fallback: string) {
  if (!error) return null
  return error.message || fallback
}
