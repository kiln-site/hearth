import { SidebarTrigger } from "@workspace/ui/components/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

export function GlobalPageToolbar({ label }: { label: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-background/92 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-3 px-3 sm:px-5 lg:px-8">
        <ToolbarSidebarTrigger />
        <span className="h-4 w-px bg-border" />
        <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          {label}
        </span>
      </div>
    </header>
  )
}

export function ToolbarSidebarTrigger() {
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
}
