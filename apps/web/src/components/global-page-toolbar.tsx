import * as React from "react"

import { SidebarTrigger } from "@workspace/ui/components/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

export const GlobalPageToolbar = React.memo(function GlobalPageToolbar({
  label,
}: {
  label: string
}) {
  return (
    <header className="shrink-0 border-b bg-background/90 backdrop-blur-xl">
      <div className="flex min-h-20 items-center gap-3 px-3 py-3 sm:px-5 lg:py-2">
        <ToolbarSidebarTrigger />
        <span className="h-6 w-px shrink-0 bg-border/80" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-mono text-[9px] tracking-[0.16em] text-primary uppercase">
            {sectionFromLabel(label)}
          </p>
          <h1 className="mt-0.5 truncate font-heading text-xl font-semibold tracking-[-0.035em]">
            {titleFromLabel(label)}
          </h1>
        </div>
      </div>
    </header>
  )
})

function sectionFromLabel(label: string) {
  const separator = label.indexOf(" / ")
  return separator === -1 ? "Hearth" : label.slice(0, separator)
}

function titleFromLabel(label: string) {
  const separator = label.lastIndexOf(" / ")
  return separator === -1 ? label : label.slice(separator + 3)
}

export const ToolbarSidebarTrigger = React.memo(function ToolbarSidebarTrigger() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarTrigger
          className="-ml-1 size-8 shrink-0 text-muted-foreground shadow-none hover:bg-accent/70 hover:text-foreground"
          aria-label="Toggle sidebar"
        />
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        Toggle sidebar
      </TooltipContent>
    </Tooltip>
  )
})
