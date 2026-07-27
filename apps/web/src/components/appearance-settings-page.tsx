import * as React from "react"
import { Check, RotateCcw, Sparkles } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import {
  defaultAccentColor,
  readAccentColor,
  saveAccentColor,
} from "@/lib/appearance"

const accentShadeLightness = [34, 42, 50, 58, 66, 74] as const

export const AppearanceSettingsPage = React.memo(
  function AppearanceSettingsPage() {
    const [accentColor, setAccentColor] = React.useState(defaultAccentColor)
    const [hexDraft, setHexDraft] = React.useState(defaultAccentColor)
    const [saved, setSaved] = React.useState(false)
    const savedTimeout = React.useRef<number | null>(null)

    React.useEffect(() => {
      const storedColor = readAccentColor()
      setAccentColor(storedColor)
      setHexDraft(storedColor)
      return () => {
        if (savedTimeout.current !== null) {
          window.clearTimeout(savedTimeout.current)
        }
      }
    }, [])

    const updateAccent = React.useCallback((color: string) => {
      if (!saveAccentColor(color)) return
      setAccentColor(color)
      setHexDraft(color)
      setSaved(true)
      if (savedTimeout.current !== null) {
        window.clearTimeout(savedTimeout.current)
      }
      savedTimeout.current = window.setTimeout(() => {
        savedTimeout.current = null
        setSaved(false)
      }, 1_400)
    }, [])

    const updateHexDraft = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const color = event.target.value
        setHexDraft(color)
        if (/^#[\da-f]{6}$/i.test(color)) updateAccent(color.toLowerCase())
      },
      [updateAccent]
    )

    return (
      <div className="mx-auto w-full max-w-6xl px-5 pb-12">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
          <section className="overflow-hidden rounded-xl border bg-card">
            <div className="border-b bg-[image:var(--surface-gradient)] px-5 py-4">
              <p className="font-mono text-[9px] tracking-[0.16em] text-primary uppercase">
                Color system
              </p>
              <h2 className="mt-1 font-heading text-lg font-semibold tracking-[-0.025em]">
                Accent
              </h2>
              <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                Pick one base color. Hearth uses its hue and saturation to
                generate fixed lightness steps for controls, focus states,
                borders, gradients, and subtly tinted neutral surfaces.
              </p>
            </div>

            <div className="space-y-6 p-5">
              <div>
                <label
                  htmlFor="accent-color"
                  className="text-xs font-medium text-foreground"
                >
                  Base accent
                </label>
                <div className="mt-2 flex items-center gap-2">
                  <label
                    className="relative grid size-10 shrink-0 cursor-pointer place-items-center overflow-hidden border border-accent-border/45 bg-primary shadow-[inset_0_1px_0_hsl(var(--accent-hue)_100%_90%/0.2)] focus-within:ring-2 focus-within:ring-ring/45"
                    aria-label="Choose accent color"
                  >
                    <input
                      id="accent-color"
                      type="color"
                      value={accentColor}
                      onChange={(event) => updateAccent(event.target.value)}
                      className="absolute inset-[-50%] size-[200%] cursor-pointer opacity-0"
                    />
                    <Sparkles
                      aria-hidden="true"
                      className="size-4 text-primary-foreground"
                    />
                  </label>
                  <div className="relative min-w-0 flex-1">
                    <Input
                      aria-label="Accent color hex value"
                      value={hexDraft}
                      onChange={updateHexDraft}
                      maxLength={7}
                      spellCheck={false}
                      className="h-10 font-mono uppercase"
                    />
                    {saved ? (
                      <span className="pointer-events-none absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1 font-mono text-[9px] text-primary uppercase">
                        <Check className="size-3" />
                        Saved
                      </span>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-lg"
                    onClick={() => updateAccent(defaultAccentColor)}
                    aria-label="Reset default accent"
                    title="Reset default accent"
                  >
                    <RotateCcw />
                  </Button>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                  Lightness is intentionally normalized by the system so text
                  and controls keep predictable contrast.
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-foreground">
                  Generated accent ramp
                </p>
                <div className="mt-2 grid grid-cols-6 overflow-hidden border border-accent-border/25">
                  {accentShadeLightness.map((lightness) => (
                    <div
                      key={lightness}
                      className="h-14 border-l border-background/45 first:border-l-0"
                      style={{
                        background: `hsl(var(--accent-hue) var(--accent-saturation) ${lightness}%)`,
                      }}
                    >
                      <span className="sr-only">{lightness}% lightness</span>
                    </div>
                  ))}
                </div>
                <div className="mt-1 grid grid-cols-6 font-mono text-[8px] text-muted-foreground">
                  {accentShadeLightness.map((lightness) => (
                    <span key={lightness}>{lightness}</span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <AppearancePreview />
        </div>
      </div>
    )
  }
)

const AppearancePreview = React.memo(function AppearancePreview() {
  return (
    <section className="overflow-hidden rounded-xl border border-accent-border/25 bg-card">
      <div className="border-b border-accent-border/20 bg-[image:var(--surface-gradient)] px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[8px] tracking-[0.16em] text-primary uppercase">
              Live preview
            </p>
            <p className="mt-1 text-sm font-semibold">Hearth surfaces</p>
          </div>
          <span className="border border-primary/30 bg-primary/8 px-2 py-1 font-mono text-[8px] text-primary uppercase">
            Active
          </span>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="rounded-lg border bg-background/70 p-3">
          <p className="text-xs font-semibold">Neutral hierarchy</p>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Background, card, muted text, and borders all share a restrained
            trace of the selected hue.
          </p>
        </div>

        <div className="rounded-lg border border-accent-border/30 bg-popover bg-[image:var(--surface-gradient)] p-3 shadow-xl shadow-black/30">
          <p className="text-xs font-semibold text-popover-foreground">
            Floating surface
          </p>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Tooltips and popovers now use the accent family instead of a
            separate red border.
          </p>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button type="button" size="sm">
            Primary action
          </Button>
          <Button type="button" variant="outline" size="sm">
            Secondary
          </Button>
        </div>
      </div>
    </section>
  )
})
