import * as React from "react"
import { useNavigate } from "@tanstack/react-router"
import {
  FileTree,
  useFileTree,
  useFileTreeSearch,
  useFileTreeSelection,
} from "@pierre/trees/react"
import type {
  RelayFileContent,
  RelayFileTree,
  RelayInstance,
} from "@workspace/contracts"
import {
  Check,
  ChevronDown,
  ChevronUp,
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
  LoaderCircle,
  LockKeyhole,
  Network,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Save,
  Search,
  Share2,
  TriangleAlert,
  Upload,
  WrapText,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { floatingSurfaceClassName } from "@workspace/ui/lib/surface-styles"
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
import { redactSensitiveText } from "@/lib/redaction"
import {
  getRelayFile,
  getRelayTree,
  saveRelayFile,
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

function parentDirectoryPaths(path: string) {
  const parts = path.split("/").filter(Boolean)
  return parts.slice(0, -1).map((_, index) => {
    return `${parts.slice(0, index + 1).join("/")}/`
  })
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

function FilePathCopyButton({ path }: { path: string }) {
  const [copyState, setCopyState] = React.useState<"idle" | "copied">("idle")
  const resetTimer = React.useRef<number | null>(null)
  const fullFilePath = `/data/${path.replace(/^\/+/, "")}`

  React.useEffect(() => {
    setCopyState("idle")
    if (resetTimer.current) window.clearTimeout(resetTimer.current)
  }, [path])

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
          <FilePathCopyButton path={path} />
        ) : (
          <p className="truncate font-mono text-[10px] text-muted-foreground sm:text-[11px]">
            /data/{path}
          </p>
        )}
      </div>
    </div>
  )
}

function Editor({
  file,
  displayPath,
  instance,
  loading,
  error,
  canShare,
  canWrite,
  onSave,
  treeCollapsed,
  onTreeExpand,
}: {
  file: RelayFileContent
  displayPath: string
  instance: RelayInstance
  loading: boolean
  error: string | null
  canShare: boolean
  canWrite: boolean
  onSave: (content: string) => Promise<void>
  treeCollapsed: boolean
  onTreeExpand: () => void
}) {
  const [value, setValue] = React.useState(file.content)
  const [savedValue, setSavedValue] = React.useState(file.content)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [shareState, setShareState] = React.useState<
    "idle" | "uploading" | "copied" | "error"
  >("idle")
  const [copyState, setCopyState] = React.useState<"idle" | "copied">("idle")
  const [redactSensitive] = React.useState(true)
  const [desktopActionsOpen, setDesktopActionsOpen] = React.useState(false)
  const [mobileActionsOpen, setMobileActionsOpen] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [reviewChanges, setReviewChanges] = React.useState(true)
  const [wrapLines, setWrapLines] = React.useState(true)
  const editorRef = React.useRef<SyntaxCodeEditorHandle>(null)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const resetShareTimer = React.useRef<number | null>(null)
  const resetCopyTimer = React.useRef<number | null>(null)
  const sectionRef = React.useRef<HTMLElement>(null)

  React.useLayoutEffect(() => {
    setValue(file.content)
    setSavedValue(file.content)
    setSaveError(null)
    setShareState("idle")
    setCopyState("idle")
    setDesktopActionsOpen(false)
    setMobileActionsOpen(false)
    setSearchOpen(false)
    setSearchQuery("")
    setReviewChanges(true)
    if (resetShareTimer.current) window.clearTimeout(resetShareTimer.current)
    if (resetCopyTimer.current) window.clearTimeout(resetCopyTimer.current)
  }, [file])

  React.useEffect(
    () => () => {
      if (resetShareTimer.current) window.clearTimeout(resetShareTimer.current)
      if (resetCopyTimer.current) window.clearTimeout(resetCopyTimer.current)
    },
    []
  )

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

  const dirty = value !== savedValue
  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(value)
      setSavedValue(value)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  async function handleShare() {
    setShareState("uploading")
    try {
      const result = await uploadToMclogs({
        data: {
          content: redactSensitive ? redactSensitiveText(value) : value,
          instanceId: instance.id,
          path: file.path,
          implementation: instance.implementation,
          version: instance.version,
        },
      })
      await copyToClipboard(result.url)
      setShareState("copied")
    } catch {
      setShareState("error")
    }
    resetShareTimer.current = window.setTimeout(
      () => setShareState("idle"),
      2800
    )
  }

  async function handleCopy() {
    await copyToClipboard(redactSensitive ? redactSensitiveText(value) : value)
    setCopyState("copied")
    if (resetCopyTimer.current) window.clearTimeout(resetCopyTimer.current)
    resetCopyTimer.current = window.setTimeout(() => setCopyState("idle"), 1800)
  }

  return (
    <section
      ref={sectionRef}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-card"
    >
      <Popover open={searchOpen} onOpenChange={setSearchOpen}>
        <PopoverAnchor asChild>
          <div className={fileEditorHeaderClassName} data-file-toolbar>
            {treeCollapsed ? (
              <FileTreeRevealButton onClick={onTreeExpand} />
            ) : null}
            <div className={fileEditorHeaderContentClassName}>
              <FileToolbarIdentity
                path={displayPath}
                readOnly={file.encoding === "gzip"}
              />

              <div
                className="ml-auto hidden max-w-full min-w-0 flex-wrap items-center justify-end gap-1 md:flex"
                data-file-editor-actions
              >
                {canShare ? (
                  <EditorTooltip
                    content={
                      shareState === "uploading"
                        ? "Uploading to mclo.gs"
                        : shareState === "copied"
                          ? "Link Copied"
                          : shareState === "error"
                            ? "Retry mclo.gs Upload"
                            : "Upload to mclo.gs"
                    }
                  >
                    <Button
                      variant={
                        shareState === "copied"
                          ? "secondary"
                          : shareState === "error"
                            ? "destructive"
                            : "ghost"
                      }
                      size="default"
                      className="h-8 shrink-0 gap-1.5 px-2.5 text-xs shadow-none disabled:opacity-100"
                      aria-label={`Upload ${formatName(file.path)} to mclo.gs and copy link`}
                      disabled={shareState === "uploading" || loading}
                      onClick={handleShare}
                    >
                      {shareState === "uploading" ? (
                        <LoaderCircle className="size-[17px] animate-spin" />
                      ) : shareState === "copied" ? (
                        <Check className="size-[17px]" />
                      ) : shareState === "error" ? (
                        <TriangleAlert className="size-[17px]" />
                      ) : (
                        <Share2 className="size-[17px]" />
                      )}
                      <span>
                        {shareState === "uploading"
                          ? "Uploading"
                          : shareState === "copied"
                            ? "Link copied"
                            : shareState === "error"
                              ? "Try again"
                              : "mclo.gs"}
                      </span>
                    </Button>
                  </EditorTooltip>
                ) : null}
                <EditorTooltip
                  content={
                    searchOpen ? "Hide Search in File" : "Search in File"
                  }
                >
                  <Button
                    variant={searchOpen ? "secondary" : "ghost"}
                    size="icon"
                    className="disabled:opacity-100"
                    aria-label={
                      searchOpen ? "Close file search" : "Search file"
                    }
                    aria-pressed={searchOpen}
                    aria-keyshortcuts="Control+F Meta+F"
                    disabled={loading}
                    onClick={() => setSearchOpen((current) => !current)}
                  >
                    <Search className="size-[17px]" />
                  </Button>
                </EditorTooltip>
                <EditorTooltip
                  content={wrapLines ? "Disable Line Wrap" : "Enable Line Wrap"}
                >
                  <Button
                    variant={wrapLines ? "secondary" : "ghost"}
                    size="icon"
                    aria-label={
                      wrapLines ? "Disable line wrap" : "Enable line wrap"
                    }
                    aria-pressed={wrapLines}
                    onClick={() => setWrapLines((current) => !current)}
                  >
                    <WrapText className="size-[17px]" />
                  </Button>
                </EditorTooltip>
                <EditorTooltip
                  content={
                    copyState === "copied"
                      ? "File Contents Copied"
                      : "Copy File Contents"
                  }
                >
                  <Button
                    variant={copyState === "copied" ? "secondary" : "ghost"}
                    size="icon"
                    aria-label={
                      copyState === "copied"
                        ? "File Contents Copied"
                        : "Copy File Contents"
                    }
                    onClick={handleCopy}
                  >
                    {copyState === "copied" ? (
                      <Check className="size-[17px]" />
                    ) : (
                      <Copy className="size-[17px]" />
                    )}
                  </Button>
                </EditorTooltip>
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
                  dirty={dirty}
                  file={file}
                  loading={loading}
                  saving={saving}
                  onSave={handleSave}
                />
                <Popover
                  open={desktopActionsOpen}
                  onOpenChange={setDesktopActionsOpen}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PopoverTrigger asChild>
                        <Button
                          variant={desktopActionsOpen ? "secondary" : "ghost"}
                          size="icon"
                          aria-label="More file actions"
                          aria-expanded={desktopActionsOpen}
                        >
                          <EllipsisVertical className="size-[18px]" />
                        </Button>
                      </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={6}>
                      More File Actions
                    </TooltipContent>
                  </Tooltip>
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
                    <FileActionMenuItem
                      active={dirty && reviewChanges}
                      icon={<GitCompareArrows />}
                      label={
                        dirty
                          ? reviewChanges
                            ? "Hide changes"
                            : "Highlight changes"
                          : "Review changes"
                      }
                      detail="Compare with the saved file"
                      disabled={!dirty || loading || file.readOnly}
                      onClick={() => {
                        setDesktopActionsOpen(false)
                        setReviewChanges((current) => !current)
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1 md:hidden">
                <EditorSaveButton
                  dirty={dirty}
                  file={file}
                  loading={loading}
                  saving={saving}
                  onSave={handleSave}
                />
                <Popover
                  open={mobileActionsOpen}
                  onOpenChange={setMobileActionsOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant={mobileActionsOpen ? "secondary" : "ghost"}
                      size="icon"
                      className="shadow-none"
                      aria-label="More file actions"
                      aria-expanded={mobileActionsOpen}
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
                    {canShare ? (
                      <FileActionMenuItem
                        icon={
                          shareState === "uploading" ? (
                            <LoaderCircle className="animate-spin" />
                          ) : shareState === "copied" ? (
                            <Check />
                          ) : shareState === "error" ? (
                            <TriangleAlert />
                          ) : (
                            <Share2 />
                          )
                        }
                        label={
                          shareState === "uploading"
                            ? "Uploading"
                            : shareState === "copied"
                              ? "Link copied"
                              : shareState === "error"
                                ? "Try mclo.gs again"
                                : "Upload to mclo.gs"
                        }
                        detail="Copies a shareable link"
                        disabled={shareState === "uploading" || loading}
                        onClick={() => void handleShare()}
                      />
                    ) : null}
                    <FileActionMenuItem
                      icon={<Search />}
                      label="Find in file"
                      detail="Search this document"
                      disabled={loading}
                      onClick={() => {
                        setMobileActionsOpen(false)
                        window.setTimeout(() => setSearchOpen(true), 0)
                      }}
                    />
                    <FileActionMenuItem
                      active={wrapLines}
                      icon={<WrapText />}
                      label="Wrap long lines"
                      detail="Fit text to the editor"
                      onClick={() => setWrapLines((current) => !current)}
                    />
                    <FileActionMenuItem
                      icon={copyState === "copied" ? <Check /> : <Copy />}
                      label={
                        copyState === "copied"
                          ? "Contents copied"
                          : "Copy contents"
                      }
                      detail="Redacts IP addresses"
                      onClick={() => void handleCopy()}
                    />
                    <FileActionMenuItem
                      active={dirty && reviewChanges}
                      icon={<GitCompareArrows />}
                      label="Review changes"
                      detail="Compare with the saved file"
                      disabled={!dirty || loading || file.readOnly}
                      onClick={() => setReviewChanges((current) => !current)}
                    />
                    <FileActionMenuItem
                      icon={<Download />}
                      label="Download"
                      detail="Coming soon"
                      disabled
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={7}
          collisionPadding={12}
          className="w-[min(18rem,calc(100vw-1rem))] p-2"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            searchInputRef.current?.focus()
          }}
        >
          <div className="flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                value={searchQuery}
                aria-label="Find in file"
                className="h-8 bg-background/70 pr-2 pl-8 font-mono text-xs shadow-none"
                placeholder="Find in file…"
                spellCheck={false}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return
                  event.preventDefault()
                  if (event.shiftKey) editorRef.current?.findPrevious()
                  else editorRef.current?.findNext()
                }}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Previous match"
              disabled={!searchQuery}
              onClick={() => editorRef.current?.findPrevious()}
            >
              <ChevronUp className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Next match"
              disabled={!searchQuery}
              onClick={() => editorRef.current?.findNext()}
            >
              <ChevronDown className="size-4" />
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <div className="editor-grid relative min-h-[360px] min-w-0 flex-1 overflow-hidden">
        <SyntaxCodeEditor
          ref={editorRef}
          ariaLabel={`Edit ${formatName(file.path)}`}
          value={value}
          originalValue={savedValue}
          onChange={setValue}
          onSearchOpenChange={setSearchOpen}
          path={file.path}
          disabled={loading}
          redactSensitive={redactSensitive}
          readOnly={file.readOnly || !canWrite}
          searchOpen={searchOpen}
          searchQuery={searchQuery}
          showChanges={reviewChanges}
          wrapLines={wrapLines}
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
          <span>
            {file.path.endsWith(".log") || file.path.endsWith(".log.gz")
              ? "LOG"
              : file.path.endsWith(".yml") || file.path.endsWith(".yaml")
                ? "YAML"
                : file.path.endsWith(".json")
                  ? "JSON"
                  : "Properties"}
          </span>
        </div>
      </div>
    </section>
  )
}

function EditorSaveButton({
  dirty,
  file,
  loading,
  saving,
  onSave,
}: {
  dirty: boolean
  file: RelayFileContent
  loading: boolean
  saving: boolean
  onSave: () => void
}) {
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
        size="icon"
        className={
          !dirty && !file.readOnly
            ? "bg-primary/35 text-primary-foreground/65 shadow-none disabled:opacity-100"
            : "shadow-none"
        }
        aria-label={
          file.readOnly
            ? "Archived log is read only"
            : dirty
              ? "Save changes"
              : "Changes saved"
        }
        disabled={!dirty || saving || loading || file.readOnly}
        onClick={onSave}
      >
        {file.readOnly ? (
          <LockKeyhole className="size-[17px]" />
        ) : saving ? (
          <LoaderCircle className="size-[17px] animate-spin" />
        ) : (
          <Save className="size-[17px]" />
        )}
        <span className="sr-only">
          {file.readOnly
            ? "Read only"
            : saving
              ? "Saving"
              : dirty
                ? "Save changes"
                : "Saved"}
        </span>
      </Button>
    </EditorTooltip>
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
  selectedPath,
  refreshing,
  mobileOpen,
  onPathChange,
  onRefresh,
  onMobileOpenChange,
  onFileSelected,
  collapsed,
  animateCollapsedChange,
  onCollapsedChange,
  initialWidth,
}: {
  instance: RelayInstance
  tree: RelayFileTree
  selectedPath: string
  refreshing: boolean
  mobileOpen: boolean
  onPathChange: (path: string) => void
  onRefresh: () => void
  onMobileOpenChange: (open: boolean) => void
  onFileSelected: () => void
  collapsed: boolean
  animateCollapsedChange: boolean
  onCollapsedChange: (collapsed: boolean) => void
  initialWidth: number | null
}) {
  const initialPath =
    selectedPath && tree.paths.includes(selectedPath) ? selectedPath : undefined
  const initialExpansionPath =
    initialPath ??
    (tree.paths.includes("server.properties")
      ? "server.properties"
      : tree.paths.find((path) => !path.endsWith("/")))
  const { model } = useFileTree({
    paths: tree.paths,
    initialExpansion: 1,
    initialExpandedPaths: [
      "config/",
      "plugins/",
      ...parentDirectoryPaths(initialExpansionPath ?? ""),
    ],
    initialSelectedPaths: initialPath ? [initialPath] : [],
    search: false,
    flattenEmptyDirectories: true,
    stickyFolders: true,
    itemHeight: 29,
    composition: { contextMenu: { enabled: true, triggerMode: "both" } },
  })
  const search = useFileTreeSearch(model)
  const selection = useFileTreeSelection(model)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
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

  function persistFileTreeWidth(width: number) {
    document.cookie = `${fileTreeWidthCookieName}=${width}; path=/; max-age=${fileTreeCookieMaxAge}; SameSite=Lax`
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

  React.useEffect(() => {
    const selected = selection.at(-1)
    if (!selected || selected.endsWith("/") || selected === selectedPath) return
    onPathChange(selected)
    onFileSelected()
  }, [onFileSelected, onPathChange, selectedPath, selection])

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
        className={`order-2 flex h-11 shrink-0 items-center overflow-hidden border-t bg-card px-1.5 md:order-1 md:h-14 md:w-[var(--file-tree-width)] md:border-t-0 md:border-b md:px-2 ${collapsed ? "md:invisible" : ""}`}
      >
        <label className="flex h-full min-w-0 flex-1 items-center">
          <Search className="ml-1 size-5 shrink-0 text-foreground/90" />
          <input
            ref={searchInputRef}
            type="search"
            value={search.value}
            placeholder="Search files…"
            aria-label="Search instance files"
            className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
            onChange={(event) => {
              const value = event.target.value
              if (value) search.setValue(value)
              else search.close()
            }}
            onFocus={() => onMobileOpenChange(true)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                search.close()
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
        <div className="flex shrink-0 items-center gap-0.5">
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="New">
                    <Plus className="size-[17px]" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                New…
              </TooltipContent>
            </Tooltip>
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
              <FileActionPreview icon={<Upload />} label="Upload files" />
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
                    <RefreshCw className="size-[17px] animate-spin" />
                  </Button>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Refresh files"
                  onClick={onRefresh}
                >
                  <RefreshCw className="size-[17px]" />
                </Button>
              )}
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {refreshing ? "Refreshing Files" : "Refresh Files"}
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
                <PanelLeftClose className="size-[17px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              Collapse File Tree
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div
        className={`order-1 min-h-0 flex-1 overflow-hidden bg-card px-1 py-1.5 md:order-2 md:block md:w-[var(--file-tree-width)] md:shrink-0 ${mobileOpen ? "block" : "hidden"} ${collapsed ? "md:invisible" : ""}`}
      >
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
              height: "100%",
            } as React.CSSProperties
          }
          renderContextMenu={(item) => (
            <div
              className={`${floatingSurfaceClassName} absolute top-full right-0 z-[100] min-w-36 border border-border/90 p-1 text-xs`}
            >
              <button className="flex w-full px-2 py-1.5 hover:bg-popover-accent">
                Open {item.path}
              </button>
              <button className="flex w-full px-2 py-1.5 hover:bg-popover-accent">
                Rename
              </button>
              <button className="flex w-full px-2 py-1.5 text-destructive hover:bg-destructive/10">
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

export function FileWorkspace({
  instance,
  active,
  routeFilePath,
  canShare,
  canWrite,
  openTreeOnEntry,
  initialTreeCollapsed,
  initialTreeWidth,
}: {
  instance: RelayInstance
  active: boolean
  routeFilePath?: string
  canShare: boolean
  canWrite: boolean
  openTreeOnEntry: boolean
  initialTreeCollapsed: boolean
  initialTreeWidth: number | null
}) {
  const navigate = useNavigate()
  const normalizedRoutePath = routeFilePath?.replace(/^\/+/, "") ?? ""
  const initialRoutePath = React.useRef(normalizedRoutePath)
  const [tree, setTree] = React.useState<RelayFileTree | null>(null)
  const [file, setFile] = React.useState<RelayFileContent | null>(null)
  const [selectedPath, setSelectedPath] = React.useState(normalizedRoutePath)
  const [mobileTreeOpen, setMobileTreeOpen] = React.useState(true)
  const [loadingFile, setLoadingFile] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [treeCollapsed, setTreeCollapsed] = React.useState(
    initialTreeCollapsed && !openTreeOnEntry
  )
  const [treeTransitionSuppressed, setTreeTransitionSuppressed] =
    React.useState(openTreeOnEntry)
  const handledTreeEntry = React.useRef(false)
  const openingTreeForRouteEntry =
    openTreeOnEntry && !handledTreeEntry.current
  const displayedTreeCollapsed =
    treeCollapsed && !openingTreeForRouteEntry
  const fileRequest = React.useRef(0)
  const requestedPath = React.useRef("")

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

  React.useEffect(() => {
    const request = ++fileRequest.current
    setTree(null)
    setFile(null)
    setSelectedPath(initialRoutePath.current)
    setMobileTreeOpen(true)
    setLoadingFile(true)
    setError(null)
    requestedPath.current = ""

    void (async () => {
      try {
        const nextTree = await getRelayTree({
          data: { instanceId: instance.id },
        })
        const initialRequestedPath = initialRoutePath.current
        if (request !== fileRequest.current) return
        setTree(nextTree)
        if (
          !initialRequestedPath &&
          window.matchMedia("(max-width: 767px)").matches
        ) {
          return
        }
        const initialPath =
          initialRequestedPath &&
          nextTree.paths.includes(initialRequestedPath) &&
          !initialRequestedPath.endsWith("/")
            ? initialRequestedPath
            : nextTree.paths.includes("server.properties")
              ? "server.properties"
              : nextTree.paths.find((path) => !path.endsWith("/"))
        if (!initialPath)
          throw new Error(`${instance.name} has no readable files`)
        requestedPath.current = initialPath
        setSelectedPath(initialPath)
        const nextFile = await getRelayFile({
          data: { instanceId: instance.id, path: initialPath },
        })
        if (request !== fileRequest.current) return
        setFile(nextFile)
        setMobileTreeOpen(false)
      } catch (cause) {
        if (request === fileRequest.current) {
          setError(
            cause instanceof Error ? cause.message : "Could not load files"
          )
        }
      } finally {
        if (request === fileRequest.current) setLoadingFile(false)
      }
    })()
  }, [instance.id, instance.name])

  const loadPath = React.useCallback(
    async (path: string) => {
      if (path === requestedPath.current) return
      requestedPath.current = path
      const request = ++fileRequest.current
      setSelectedPath(path)
      setLoadingFile(true)
      setError(null)
      try {
        const next = await getRelayFile({
          data: { instanceId: instance.id, path },
        })
        if (request === fileRequest.current) setFile(next)
      } catch (cause) {
        if (request === fileRequest.current) {
          requestedPath.current = ""
          setError(
            cause instanceof Error ? cause.message : "Could not read file"
          )
        }
      } finally {
        if (request === fileRequest.current) setLoadingFile(false)
      }
    },
    [instance.id]
  )

  const handlePathChange = React.useCallback(
    async (path: string) => {
      if (active && normalizedRoutePath !== path) {
        try {
          await navigate({
            to: "/$serverId/files/$",
            params: { serverId: instance.shortId, _splat: path },
            replace: true,
          })
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not open the selected file"
          )
        }
        return
      }
      await loadPath(path)
    },
    [active, instance.shortId, loadPath, navigate, normalizedRoutePath]
  )

  const closeMobileTree = React.useCallback(() => {
    setMobileTreeOpen(false)
  }, [])

  React.useEffect(() => {
    if (!active || !tree) return

    const routePathIsValid =
      normalizedRoutePath &&
      tree.paths.includes(normalizedRoutePath) &&
      !normalizedRoutePath.endsWith("/")

    if (!routePathIsValid) {
      if (!selectedPath) return
      void navigate({
        to: "/$serverId/files/$",
        params: { serverId: instance.shortId, _splat: selectedPath },
        replace: true,
      }).catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not update the file URL"
        )
      })
      return
    }

    void loadPath(normalizedRoutePath)
  }, [
    active,
    instance.shortId,
    loadPath,
    navigate,
    normalizedRoutePath,
    selectedPath,
    tree,
  ])

  async function handleRefresh() {
    setRefreshing(true)
    setError(null)
    try {
      setTree(await getRelayTree({ data: { instanceId: instance.id } }))
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not refresh files"
      )
    } finally {
      setRefreshing(false)
    }
  }

  async function handleSave(content: string) {
    if (!file) return
    const next = await saveRelayFile({
      data: {
        instanceId: instance.id,
        path: file.path,
        content,
        expectedModifiedAt: file.modifiedAt,
      },
    })
    setFile(next)
  }

  return (
    <div
      className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden md:flex-row"
      data-file-workspace
    >
      {tree ? (
        <FileTreePanel
          key={instance.id}
          instance={instance}
          tree={tree}
          selectedPath={selectedPath}
          refreshing={refreshing}
          mobileOpen={mobileTreeOpen}
          onPathChange={handlePathChange}
          onRefresh={handleRefresh}
          onMobileOpenChange={setMobileTreeOpen}
          onFileSelected={closeMobileTree}
          collapsed={displayedTreeCollapsed}
          animateCollapsedChange={
            !openingTreeForRouteEntry && !treeTransitionSuppressed
          }
          onCollapsedChange={handleTreeCollapsedChange}
          initialWidth={initialTreeWidth}
        />
      ) : (
        <FileTreeLoadingPanel
          collapsed={displayedTreeCollapsed}
          width={initialTreeWidth}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 pb-11 md:pb-0">
        {!tree || !file ? (
          <UnavailablePreview
            path={selectedPath || normalizedRoutePath || instance.name}
            pathIsCopyable={Boolean(selectedPath || normalizedRoutePath)}
            loading={loadingFile}
            message={error}
            canShare={canShare}
            treeCollapsed={displayedTreeCollapsed}
            onTreeExpand={handleTreeExpand}
          />
        ) : selectedPath !== file.path && !loadingFile ? (
          <UnavailablePreview
            path={selectedPath}
            pathIsCopyable
            loading={loadingFile}
            message={error}
            canShare={canShare}
            treeCollapsed={displayedTreeCollapsed}
            onTreeExpand={handleTreeExpand}
          />
        ) : (
          <Editor
            canShare={canShare}
            canWrite={canWrite}
            file={file}
            displayPath={selectedPath || file.path}
            instance={instance}
            loading={loadingFile || selectedPath !== file.path}
            error={error}
            onSave={handleSave}
            treeCollapsed={displayedTreeCollapsed}
            onTreeExpand={handleTreeExpand}
          />
        )}
      </div>
    </div>
  )
}
