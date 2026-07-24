import * as React from "react"
import type { Brick } from "@workspace/contracts"
import {
  BadgeCheck,
  BookOpen,
  FileCode2,
  PackagePlus,
  Search,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

import { ServerTypeIcon } from "@/components/server-type-icon"

export type BrickSelection =
  | { kind: "catalog"; brick: Brick }
  | { kind: "custom"; source: string }

type BrickCategoryId = "all" | "minecraft" | "proxy" | "steam" | "other"
type BrickSourceFilter = "all" | "official" | "community"
type BrickSort = "featured" | "name-asc" | "name-desc"

const CATEGORIES: ReadonlyArray<{ id: BrickCategoryId; label: string }> = [
  { id: "all", label: "All" },
  { id: "minecraft", label: "Minecraft" },
  { id: "proxy", label: "Proxy" },
  { id: "steam", label: "Steam" },
  { id: "other", label: "Other" },
]

const SOURCE_FILTERS: ReadonlyArray<{
  id: BrickSourceFilter
  label: string
}> = [
  { id: "all", label: "All Sources" },
  { id: "official", label: "Official" },
  { id: "community", label: "Community" },
]

const SORT_OPTIONS: ReadonlyArray<{ id: BrickSort; label: string }> = [
  { id: "featured", label: "Sort: Featured" },
  { id: "name-asc", label: "Sort: Name A–Z" },
  { id: "name-desc", label: "Sort: Name Z–A" },
]

const EMPTY_BRICKS: Array<Brick> = []

function isOfficialBrick(brick: Brick): boolean {
  if (brick.metadata.author.trim().toLowerCase() === "kiln") return true
  try {
    const host = new URL(brick.source).hostname.toLowerCase()
    return (
      host === "raw.githubusercontent.com" &&
      brick.source.includes("/kiln-site/bricks/")
    )
  } catch {
    return false
  }
}

function brickCategory(brick: Brick): Exclude<BrickCategoryId, "all"> {
  const tags = new Set(
    (brick.metadata.tags ?? []).map((tag) => tag.toLowerCase())
  )
  if (brick.network.mode === "minecraft-proxy" || tags.has("proxy")) {
    return "proxy"
  }
  if (
    tags.has("steam") ||
    brick.runtime.image.toLowerCase().includes("steam")
  ) {
    return "steam"
  }
  if (brick.metadata.game.trim().toLowerCase() === "minecraft") {
    return "minecraft"
  }
  return "other"
}

function brickSearchText(brick: Brick): string {
  return [
    brick.metadata.name,
    brick.metadata.game,
    brick.metadata.id,
    brick.metadata.author,
    brick.metadata.description,
    ...(brick.metadata.tags ?? []),
  ]
    .join(" ")
    .toLowerCase()
}

function formatGameLabel(brick: Brick): string {
  const tags = new Set(brick.metadata.tags ?? [])
  if (tags.has("java")) return `${brick.metadata.game} - Java`
  if (tags.has("bedrock")) return `${brick.metadata.game} - Bedrock`
  return brick.metadata.game
}

function sourceLabel(brick: Brick): string {
  return isOfficialBrick(brick) ? "Official" : "Community"
}

function filterAndSortBricks(
  bricks: Array<Brick>,
  {
    category,
    query,
    sort,
    sourceFilter,
  }: {
    category: BrickCategoryId
    query: string
    sort: BrickSort
    sourceFilter: BrickSourceFilter
  }
): Array<Brick> {
  const normalized = query.trim().toLowerCase()
  const searchTextBySource = new Map<string, string>()
  for (const brick of bricks) {
    searchTextBySource.set(brick.source, brickSearchText(brick))
  }

  const filtered = bricks.filter((brick) => {
    if (category !== "all" && brickCategory(brick) !== category) return false
    if (sourceFilter === "official" && !isOfficialBrick(brick)) return false
    if (sourceFilter === "community" && isOfficialBrick(brick)) return false
    if (!normalized) return true
    const text = searchTextBySource.get(brick.source) ?? ""
    return text.includes(normalized)
  })

  return filtered.sort((a, b) => {
    if (sort === "name-asc") {
      return a.metadata.name.localeCompare(b.metadata.name)
    }
    if (sort === "name-desc") {
      return b.metadata.name.localeCompare(a.metadata.name)
    }
    const officialDelta =
      Number(isOfficialBrick(b)) - Number(isOfficialBrick(a))
    if (officialDelta !== 0) return officialDelta
    return a.metadata.name.localeCompare(b.metadata.name)
  })
}

const selectClassName =
  "h-8 w-full rounded-md border border-input bg-input/18 px-2.5 text-xs text-foreground outline-none transition-[border-color,background-color,box-shadow] duration-150 hover:bg-input/24 focus-visible:border-ring/75 focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50"

export const BrickCatalogBrowser = React.memo(function BrickCatalogBrowser({
  bricks,
  selection,
  onSelectionChange,
  disabled = false,
  className,
  configuration,
  emptyMessage = "No bricks match these filters.",
}: {
  bricks: Array<Brick>
  selection: BrickSelection | null
  onSelectionChange: (selection: BrickSelection | null) => void
  disabled?: boolean
  className?: string
  configuration?: React.ReactNode
  emptyMessage?: string
}) {
  const [category, setCategory] = React.useState<BrickCategoryId>("all")
  const [query, setQuery] = React.useState("")
  const [sourceFilter, setSourceFilter] =
    React.useState<BrickSourceFilter>("all")
  const [sort, setSort] = React.useState<BrickSort>("featured")

  const catalogBricks = bricks.length > 0 ? bricks : EMPTY_BRICKS
  const visibleBricks = React.useMemo(
    () =>
      filterAndSortBricks(catalogBricks, {
        category,
        query,
        sort,
        sourceFilter,
      }),
    [catalogBricks, category, query, sort, sourceFilter]
  )

  const selectedCatalog = selection?.kind === "catalog" ? selection.brick : null
  const customOpen = selection?.kind === "custom"

  return (
    <div
      className={cn(
        "grid min-h-0 flex-1 overflow-hidden rounded-xl border border-border/70 bg-background/35 max-md:overflow-y-auto md:grid-cols-[9.5rem_minmax(0,1fr)_18.5rem] lg:grid-cols-[10.5rem_minmax(0,1fr)_20rem]",
        className
      )}
    >
      <aside className="flex min-h-0 flex-col border-b border-border/60 md:border-r md:border-b-0">
        <p className="px-3 pt-3 pb-2 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          Categories
        </p>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-y-auto md:pb-3">
          {CATEGORIES.map((item) => {
            const active = !customOpen && category === item.id
            return (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setCategory(item.id)
                  if (!customOpen) return
                  const next =
                    filterAndSortBricks(catalogBricks, {
                      category: item.id,
                      query,
                      sort,
                      sourceFilter,
                    })[0] ?? catalogBricks[0]
                  onSelectionChange(
                    next ? { kind: "catalog", brick: next } : null
                  )
                }}
                className={cn(
                  "relative shrink-0 rounded-md px-2.5 py-2 text-left text-xs transition-colors duration-150",
                  active
                    ? "bg-primary/12 font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/55 hover:text-foreground",
                  disabled && "pointer-events-none opacity-50"
                )}
              >
                {active ? (
                  <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary md:left-0" />
                ) : null}
                <span className={cn(active && "pl-1.5")}>{item.label}</span>
              </button>
            )
          })}
        </nav>
        <div className="mt-auto border-t border-border/60 p-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              onSelectionChange({
                kind: "custom",
                source: selection?.kind === "custom" ? selection.source : "",
              })
            }
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors duration-150",
              customOpen
                ? "bg-primary/12 font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent/55 hover:text-foreground",
              disabled && "pointer-events-none opacity-50"
            )}
          >
            <PackagePlus className="size-3.5 shrink-0 text-primary" />
            Custom Brick
          </button>
        </div>
      </aside>

      <section className="flex min-h-80 min-w-0 flex-col border-b border-border/60 md:min-h-0 md:border-r md:border-b-0">
        <div className="space-y-2 border-b border-border/60 p-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              disabled={disabled || customOpen}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search bricks…"
              className="h-9 pl-8 text-base md:text-sm"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={sourceFilter}
              disabled={disabled || customOpen}
              onChange={(event) => {
                const next = SOURCE_FILTERS.find(
                  (option) => option.id === event.target.value
                )
                if (next) setSourceFilter(next.id)
              }}
              className={selectClassName}
              aria-label="Filter by source"
            >
              {SOURCE_FILTERS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={sort}
              disabled={disabled || customOpen}
              onChange={(event) => {
                const next = SORT_OPTIONS.find(
                  (option) => option.id === event.target.value
                )
                if (next) setSort(next.id)
              }}
              className={selectClassName}
              aria-label="Sort bricks"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {customOpen ? (
            <div className="grid h-full place-items-center px-4 py-8 text-center">
              <div className="max-w-xs">
                <PackagePlus className="mx-auto size-5 text-primary" />
                <p className="mt-2 text-sm font-medium">Custom recipe</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Paste an HTTPS Brick recipe URL in the details panel.
                </p>
              </div>
            </div>
          ) : visibleBricks.length === 0 ? (
            <div className="grid h-full place-items-center px-4 py-8 text-center text-xs text-muted-foreground">
              {emptyMessage}
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {visibleBricks.map((brick) => {
                const selected = selectedCatalog?.source === brick.source
                const official = isOfficialBrick(brick)
                return (
                  <li key={brick.source}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        onSelectionChange({ kind: "catalog", brick })
                      }
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors duration-150",
                        selected
                          ? "bg-primary/14 ring-1 ring-primary/35"
                          : "hover:bg-accent/55",
                        disabled && "pointer-events-none opacity-50"
                      )}
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border/70 bg-background/70 text-muted-foreground">
                        <ServerTypeIcon
                          implementation={brick.metadata.id}
                          className="size-4"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold tracking-tight">
                          {brick.metadata.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {sourceLabel(brick)} · {formatGameLabel(brick)}
                        </span>
                      </span>
                      {official ? (
                        <Badge
                          variant="outline"
                          className="h-5 shrink-0 border-primary/35 bg-primary/10 px-1.5 font-mono text-[10px] text-primary"
                        >
                          Official
                        </Badge>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      <BrickDetailsPanel
        selection={selection}
        disabled={disabled}
        onSelectionChange={onSelectionChange}
        configuration={configuration}
      />
    </div>
  )
})

const BrickDetailsPanel = React.memo(function BrickDetailsPanel({
  selection,
  disabled,
  onSelectionChange,
  configuration,
}: {
  selection: BrickSelection | null
  disabled: boolean
  onSelectionChange: (selection: BrickSelection | null) => void
  configuration?: React.ReactNode
}) {
  if (selection?.kind === "custom") {
    return (
      <aside className="flex min-h-96 flex-col md:min-h-0">
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pr-11">
          <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
            Custom recipe
          </p>
          <h3 className="mt-2 font-heading text-lg font-semibold tracking-[-0.03em]">
            Bring your own Brick
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Point Kiln at any HTTPS recipe. Validate it on a Relay before
            provisioning production servers.
          </p>
          <label className="mt-4 block space-y-1.5 text-xs font-medium text-muted-foreground">
            <span>Recipe URL</span>
            <Input
              type="url"
              value={selection.source}
              disabled={disabled}
              onChange={(event) =>
                onSelectionChange({
                  kind: "custom",
                  source: event.target.value,
                })
              }
              placeholder="https://example.com/my-brick.yml"
              required
            />
          </label>
        </div>
        {configuration ? (
          <div className="shrink-0 border-t border-border/60 p-4">
            {configuration}
          </div>
        ) : null}
      </aside>
    )
  }

  if (!selection) {
    return (
      <aside className="flex min-h-96 flex-col md:min-h-0">
        <div className="grid min-h-48 flex-1 place-items-center p-6 text-center">
          <p className="text-xs text-muted-foreground">
            Select a Brick to inspect its details.
          </p>
        </div>
        {configuration ? (
          <div className="shrink-0 border-t border-border/60 p-4">
            {configuration}
          </div>
        ) : null}
      </aside>
    )
  }

  const brick = selection.brick
  const official = isOfficialBrick(brick)
  const tags = brick.metadata.tags ?? []

  return (
    <aside className="flex min-h-96 flex-col md:min-h-0">
      <div className="min-h-0 flex-1 overflow-y-auto p-4 pr-11">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-border/70 bg-background/70 text-muted-foreground">
            <ServerTypeIcon
              implementation={brick.metadata.id}
              className="size-5"
            />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="truncate font-heading text-lg font-semibold tracking-[-0.03em]">
                {brick.metadata.name}
              </h3>
              {official ? (
                <Badge
                  variant="outline"
                  className="h-5 gap-1 border-primary/35 bg-primary/10 px-1.5 text-[10px] text-primary"
                >
                  <BadgeCheck className="size-3" />
                  Official
                </Badge>
              ) : (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  Community
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {formatGameLabel(brick)} · {brick.metadata.author}
            </p>
          </div>
        </div>

        <p className="mt-4 text-[13px] leading-relaxed text-foreground/90">
          {brick.metadata.description}
        </p>

        <dl className="mt-4 space-y-2.5 border-t border-border/60 pt-4 text-xs">
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">Runtime</dt>
            <dd className="truncate text-right font-medium">
              {brick.runtime.name}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">Network</dt>
            <dd className="truncate text-right font-medium capitalize">
              {brick.network.mode.replaceAll("-", " ")}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">Architectures</dt>
            <dd className="truncate text-right font-mono text-[11px]">
              {(brick.constraints.architectures ?? ["any"]).join(", ")}
            </dd>
          </div>
          {brick.constraints.singleton ? (
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">Constraint</dt>
              <dd className="text-right font-medium">Singleton on Relay</dd>
            </div>
          ) : null}
        </dl>

        {tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="h-5 px-1.5 font-mono text-[10px] text-muted-foreground"
              >
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={brick.source} target="_blank" rel="noreferrer">
              <FileCode2 />
              View raw Brick
            </a>
          </Button>
          {brick.metadata.documentation ? (
            <Button asChild size="sm" variant="ghost">
              <a
                href={brick.metadata.documentation}
                target="_blank"
                rel="noreferrer"
              >
                <BookOpen />
                Docs
              </a>
            </Button>
          ) : null}
        </div>
      </div>
      {configuration ? (
        <div className="shrink-0 border-t border-border/60 p-4">
          {configuration}
        </div>
      ) : null}
    </aside>
  )
})

export const BrickSelectDialog = React.memo(function BrickSelectDialog({
  open,
  onOpenChange,
  bricks,
  initial,
  title = "Select Brick",
  description = "Browse or search bricks from the catalog.",
  confirmLabel = "Select Brick",
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bricks: Array<Brick>
  initial: BrickSelection | null
  title?: string
  description?: string
  confirmLabel?: string
  onConfirm: (selection: BrickSelection) => void
}) {
  const [selection, setSelection] = React.useState<BrickSelection | null>(
    initial
  )

  React.useEffect(() => {
    if (open) setSelection(initial)
  }, [initial, open])

  const canConfirm =
    selection?.kind === "catalog" ||
    (selection?.kind === "custom" && selection.source.trim().length > 0)
  const actions = React.useMemo(
    () => (
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!canConfirm || !selection}
          onClick={() => {
            if (!selection || !canConfirm) return
            onConfirm(selection)
            onOpenChange(false)
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    ),
    [canConfirm, confirmLabel, onConfirm, onOpenChange, selection]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(36rem,calc(100dvh-2rem))] max-h-none gap-0 overflow-hidden p-0 sm:max-w-[calc(100%-2rem)] xl:max-w-5xl">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <BrickCatalogBrowser
          bricks={bricks}
          selection={selection}
          onSelectionChange={setSelection}
          className="h-full rounded-none border-0 bg-transparent"
          emptyMessage={
            bricks.length === 0 ? description : "No bricks match these filters."
          }
          configuration={actions}
        />
      </DialogContent>
    </Dialog>
  )
})
