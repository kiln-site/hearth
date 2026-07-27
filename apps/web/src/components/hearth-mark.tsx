import { BrickWallFire } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

export function HearthMark({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative grid size-8 shrink-0 place-items-center overflow-hidden bg-primary text-primary-foreground shadow-[inset_0_0_0_1px_hsl(var(--accent-hue)_100%_96%/0.14),var(--brand-shadow)]",
        className
      )}
    >
      <BrickWallFire className="size-[78%]!" strokeWidth={1.9} />
    </div>
  )
}
