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
      <svg viewBox="0 0 32 32" className="size-full" fill="none">
        <path
          d="M9 20.5h14M10.75 24h10.5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          opacity=".55"
        />
        <path
          d="M16.2 7.2c.5 3.9-3.7 4.5-3.7 8.2 0 2.2 1.6 3.7 3.6 3.7 2.3 0 4-1.6 4-4.1 0-1.8-1-3.6-2.2-4.8.1 1.7-.8 2.7-1.8 3.2.4-2.5-.4-4.6.1-6.2Z"
          fill="currentColor"
        />
      </svg>
    </div>
  )
}
