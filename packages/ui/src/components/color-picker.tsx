"use client"

import * as React from "react"
import { Trash2 } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

type HsvColor = {
  hue: number
  saturation: number
  value: number
}

type ColorPickerProps = {
  children: React.ReactNode
  className?: string
  onOpenChange?: (open: boolean) => void
  onRemove?: () => void
  onValueChange: (value: string) => void
  open?: boolean
  value: string
}

function ColorPicker({
  children,
  className,
  onOpenChange,
  onRemove,
  onValueChange,
  open,
  value,
}: ColorPickerProps) {
  const brightnessId = React.useId()
  const [color, setColor] = React.useState<HsvColor>(() => hexToHsv(value))
  const [hexDraft, setHexDraft] = React.useState(value.toUpperCase())

  React.useEffect(() => {
    const normalized = normalizeHex(value)
    if (normalized) {
      setColor((currentColor) =>
        hsvToHex(currentColor) === normalized
          ? currentColor
          : hexToHsv(normalized)
      )
    }
    setHexDraft(value.toUpperCase())
  }, [value])

  const commitColor = React.useCallback(
    (nextColor: HsvColor) => {
      const nextHex = hsvToHex(nextColor)
      setColor(nextColor)
      setHexDraft(nextHex.toUpperCase())
      onValueChange(nextHex)
    },
    [onValueChange]
  )

  const updateFromPointer = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect()
      const horizontal = clamp((event.clientX - bounds.left) / bounds.width)
      const vertical = clamp((event.clientY - bounds.top) / bounds.height)
      commitColor({
        ...color,
        hue: horizontal * 360,
        saturation: saturationFromVertical(vertical),
      })
    },
    [color, commitColor]
  )

  const updateHexDraft = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextDraft = event.target.value
      setHexDraft(nextDraft)
      const normalized = normalizeHex(nextDraft)
      if (normalized) commitColor(hexToHsv(normalized))
    },
    [commitColor]
  )

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className={cn("w-72 p-3", className)}
      >
        <div
          data-slot="color-picker-area"
          role="group"
          tabIndex={0}
          aria-label="Hue and saturation"
          onKeyDown={(event) => {
            const step = event.shiftKey ? 10 : 2
            if (
              !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                event.key
              )
            ) {
              return
            }
            event.preventDefault()
            commitColor({
              ...color,
              hue:
                event.key === "ArrowLeft"
                  ? color.hue - step
                  : event.key === "ArrowRight"
                    ? color.hue + step
                    : color.hue,
              saturation:
                event.key === "ArrowUp"
                  ? color.saturation + step
                  : event.key === "ArrowDown"
                    ? color.saturation - step
                    : color.saturation,
            })
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            updateFromPointer(event)
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              updateFromPointer(event)
            }
          }}
          className="relative aspect-square w-full cursor-crosshair touch-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
          style={{
            backgroundImage:
              "linear-gradient(to bottom, transparent 0%, rgb(255 255 255 / 0.08) 55%, rgb(255 255 255 / 0.42) 82%, #fff 100%), linear-gradient(to right, #f00 0%, #ff0 16.667%, #0f0 33.333%, #0ff 50%, #00f 66.667%, #f0f 83.333%, #f00 100%)",
          }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute size-4 -translate-1/2 border-2 border-white bg-transparent shadow-[0_1px_4px_rgb(0_0_0/0.8)] ring-1 ring-black/60"
            style={{
              backgroundColor: hsvToHex(color),
              left: `${color.hue / 3.6}%`,
              top: `${verticalFromSaturation(color.saturation) * 100}%`,
            }}
          />
        </div>

        <div className="mt-3">
          <label className="sr-only" htmlFor={brightnessId}>
            Brightness
          </label>
          <div className="relative h-4">
            <input
              id={brightnessId}
              data-slot="color-picker-brightness"
              type="range"
              aria-label="Brightness"
              min={0}
              max={100}
              value={Math.round(color.value)}
              onChange={(event) =>
                commitColor({ ...color, value: Number(event.target.value) })
              }
              className="absolute top-1/2 h-3 w-full -translate-y-1/2 cursor-pointer appearance-none border border-white/15 outline-none focus-visible:ring-2 focus-visible:ring-ring/45 [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-transparent"
              style={{ background: "linear-gradient(to right, #000, #fff)" }}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 border-2 border-background bg-white shadow-sm"
              style={{
                left: `calc(${color.value}% - ${color.value * 0.16}px)`,
              }}
            />
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <Input
            aria-label="Hex color"
            value={hexDraft}
            onChange={updateHexDraft}
            onBlur={() => setHexDraft(value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur()
            }}
            maxLength={7}
            spellCheck={false}
            className="h-9 min-w-0 font-mono uppercase"
          />
          {onRemove ? (
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              onClick={onRemove}
              aria-label="Remove custom color"
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function normalizeHex(value: string): string | null {
  const candidate = value.trim()
  const prefixed = candidate.startsWith("#") ? candidate : `#${candidate}`
  return /^#[\da-f]{6}$/i.test(prefixed) ? prefixed.toLowerCase() : null
}

function hexToHsv(value: string): HsvColor {
  const normalized = normalizeHex(value) ?? "#000000"
  const red = Number.parseInt(normalized.slice(1, 3), 16) / 255
  const green = Number.parseInt(normalized.slice(3, 5), 16) / 255
  const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  const delta = maximum - minimum

  let hue = 0
  if (delta > 0) {
    if (maximum === red) hue = ((green - blue) / delta) % 6
    else if (maximum === green) hue = (blue - red) / delta + 2
    else hue = (red - green) / delta + 4
    hue *= 60
    if (hue < 0) hue += 360
  }

  return {
    hue,
    saturation: maximum === 0 ? 0 : (delta / maximum) * 100,
    value: maximum * 100,
  }
}

function hsvToHex(color: HsvColor): string {
  const hue = ((color.hue % 360) + 360) % 360
  const saturation = clamp(color.saturation / 100)
  const value = clamp(color.value / 100)
  const chroma = value * saturation
  const section = hue / 60
  const intermediate = chroma * (1 - Math.abs((section % 2) - 1))
  const offset = value - chroma

  const [red, green, blue] =
    section < 1
      ? [chroma, intermediate, 0]
      : section < 2
        ? [intermediate, chroma, 0]
        : section < 3
          ? [0, chroma, intermediate]
          : section < 4
            ? [0, intermediate, chroma]
            : section < 5
              ? [intermediate, 0, chroma]
              : [chroma, 0, intermediate]

  return `#${[red, green, blue]
    .map((channel) =>
      Math.round((channel + offset) * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value))
}

function saturationFromVertical(vertical: number) {
  return (1 - vertical ** 3) * 100
}

function verticalFromSaturation(saturation: number) {
  return Math.cbrt(1 - clamp(saturation / 100))
}

export { ColorPicker }
