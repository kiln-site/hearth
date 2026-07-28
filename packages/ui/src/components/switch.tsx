import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

type SwitchProps = Omit<
  React.ComponentPropsWithoutRef<"button">,
  "defaultChecked" | "onChange"
> & {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  {
    checked: controlledChecked,
    className,
    defaultChecked = false,
    disabled,
    onCheckedChange,
    onClick,
    ...props
  },
  ref
) {
  const controlled = controlledChecked !== undefined
  const [uncontrolledChecked, setUncontrolledChecked] =
    React.useState(defaultChecked)
  const checked = controlled ? controlledChecked : uncontrolledChecked

  return (
    <button
      {...props}
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        const next = !checked
        if (!controlled) setUncontrolledChecked(next)
        onCheckedChange?.(next)
      }}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 border transition-[background-color,border-color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "border-primary bg-primary"
          : "border-input bg-muted-foreground/20",
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-0.5 left-0.5 size-[22px] bg-background shadow-sm transition-transform",
          checked ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  )
})

export { Switch }
export type { SwitchProps }
