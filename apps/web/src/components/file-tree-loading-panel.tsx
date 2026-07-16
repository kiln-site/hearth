import * as React from "react"
import { LoaderCircle } from "lucide-react"

export function FileWorkspaceLoadingState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="max-w-xs" role="status" aria-live="polite">
      <div className="mx-auto mb-4 grid size-11 place-items-center rounded-xl border bg-muted/20 text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin text-primary" />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  )
}

export function FileTreeLoadingPanel({
  collapsed,
  width,
}: {
  collapsed: boolean
  width: number | null
}) {
  if (collapsed) {
    return (
      <div
        className="hidden w-0 shrink-0 md:block"
        data-file-tree-loading-panel
        aria-hidden="true"
      />
    )
  }

  return (
    <div
      className="hidden w-[var(--file-tree-width)] max-w-[45%] min-w-56 shrink-0 border-r border-border/80 bg-card md:block md:[--file-tree-width:17.5rem] xl:max-w-[30rem] xl:[--file-tree-width:19rem]"
      style={
        width
          ? ({ "--file-tree-width": `${width}px` } as React.CSSProperties)
          : undefined
      }
      data-file-tree-loading-panel
      aria-hidden="true"
    >
      <div className="h-14 border-b" />
      <div className="space-y-2 px-3 py-3">
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            className="h-4 animate-pulse bg-muted/25"
            style={{ width: `${58 + ((index * 13) % 31)}%` }}
          />
        ))}
      </div>
    </div>
  )
}
