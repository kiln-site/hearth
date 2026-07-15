import { BrickWallFire } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

export function HearthMark({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative grid size-8 shrink-0 place-items-center overflow-hidden bg-primary text-primary-foreground shadow-[inset_0_0_0_1px_oklch(1_0_0/0.14),0_5px_14px_oklch(0.35_0.08_45/0.2)]",
        className
      )}
    >
      <BrickWallFire className="size-[78%]!" strokeWidth={1.9} />
    </div>
  )
}
