import * as React from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { Check, Flame, Moon, RotateCcw, Sparkles, Sun } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import {
  defaultAccentColor,
  isNightlyVersion,
  saveAppearanceCache,
} from "@/lib/appearance"
import type {
  AppearanceOverride,
  AppearancePreferences,
  ColorScheme,
} from "@/lib/appearance"
import { uiPreferencesQueryOptions } from "@/lib/query-options"
import { updateAppearancePreferences } from "@/server/preferences"

const accentShadeLightness = [34, 42, 50, 58, 66, 74] as const
const persistDelay = 300
const firePresets = [
  { color: "#ef4444", label: "Ember" },
  { color: "#f97316", label: "Orange" },
  { color: "#eab308", label: "Gold" },
  { color: "#38bdf8", label: "Blue fire" },
  { color: "#f5f5f4", label: "White-hot" },
] as const

type SaveState = "idle" | "saving" | "saved" | "error"

export const AppearanceSettingsPage = React.memo(
  function AppearanceSettingsPage() {
    const { data: uiPreferences } = useSuspenseQuery(
      uiPreferencesQueryOptions()
    )
    const [appearance, setAppearance] = React.useState<AppearancePreferences>(
      uiPreferences.appearance
    )
    const [customAccentColor, setCustomAccentColor] = React.useState<
      string | null
    >(uiPreferences.customAccentColor)
    const [hexDraft, setHexDraft] = React.useState(appearance.accentColor)
    const [saveState, setSaveState] = React.useState<SaveState>("idle")
    const persistTimeout = React.useRef<number | null>(null)
    const pendingOverride = React.useRef<AppearanceOverride | null>(null)
    const savedTimeout = React.useRef<number | null>(null)

    const persist = React.useCallback(async (override: AppearanceOverride) => {
      setSaveState("saving")
      try {
        await updateAppearancePreferences({ data: override })
        setSaveState("saved")
        if (savedTimeout.current !== null) {
          window.clearTimeout(savedTimeout.current)
        }
        savedTimeout.current = window.setTimeout(() => {
          savedTimeout.current = null
          setSaveState("idle")
        }, 1_400)
      } catch {
        setSaveState("error")
      }
    }, [])

    const schedulePersist = React.useCallback(
      (override: AppearanceOverride) => {
        pendingOverride.current = override
        if (persistTimeout.current !== null) {
          window.clearTimeout(persistTimeout.current)
        }
        persistTimeout.current = window.setTimeout(() => {
          persistTimeout.current = null
          const pending = pendingOverride.current
          pendingOverride.current = null
          if (pending) void persist(pending)
        }, persistDelay)
      },
      [persist]
    )

    React.useEffect(() => {
      return () => {
        if (savedTimeout.current !== null) {
          window.clearTimeout(savedTimeout.current)
        }
        if (persistTimeout.current !== null) {
          window.clearTimeout(persistTimeout.current)
          const pending = pendingOverride.current
          if (pending) {
            void updateAppearancePreferences({ data: pending })
          }
        }
      }
    }, [])

    const updateAppearance = React.useCallback(
      (next: AppearancePreferences, customColor: string | null) => {
        if (!saveAppearanceCache(next)) return
        setAppearance(next)
        setCustomAccentColor(customColor)
        setHexDraft(next.accentColor)
        schedulePersist({
          accentColor: customColor,
          colorScheme: next.colorScheme,
        })
      },
      [schedulePersist]
    )

    const updateAccent = React.useCallback(
      (color: string) => {
        updateAppearance(
          { ...appearance, accentColor: color.toLowerCase() },
          color.toLowerCase()
        )
      },
      [appearance, updateAppearance]
    )

    const updateColorScheme = React.useCallback(
      (colorScheme: ColorScheme) => {
        updateAppearance({ ...appearance, colorScheme }, customAccentColor)
      },
      [appearance, customAccentColor, updateAppearance]
    )

    const updateHexDraft = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const color = event.target.value
        setHexDraft(color)
        if (/^#[\da-f]{6}$/i.test(color)) updateAccent(color)
      },
      [updateAccent]
    )

    const nightlyDefault = isNightlyVersion(import.meta.env.VITE_KILN_VERSION)

    return (
      <div className="mx-auto w-full max-w-6xl px-5 pb-12">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
          <section className="overflow-hidden rounded-xl border bg-card">
            <div className="border-b bg-[image:var(--surface-gradient)] px-5 py-4">
              <p className="font-mono text-[9px] tracking-[0.16em] text-primary uppercase">
                Color system
              </p>
              <h2 className="mt-1 font-heading text-lg font-semibold tracking-[-0.025em]">
                Fire &amp; light
              </h2>
              <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                One fire color generates fixed HSL steps for controls, focus
                states, borders, gradients, and subtly tinted neutral surfaces.
                Status and chart palettes stay independent.
              </p>
            </div>

            <div className="space-y-7 p-5">
              <div>
                <p className="text-xs font-medium text-foreground">
                  Surface mode
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <ModeButton
                    active={appearance.colorScheme === "dark"}
                    description="Charcoal night surfaces"
                    icon={Moon}
                    label="Dark"
                    onClick={() => updateColorScheme("dark")}
                  />
                  <ModeButton
                    active={appearance.colorScheme === "light"}
                    description="Warm white surfaces"
                    icon={Sun}
                    label="Light"
                    onClick={() => updateColorScheme("light")}
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="accent-color"
                  className="text-xs font-medium text-foreground"
                >
                  Base fire color
                </label>
                <div className="mt-2 flex items-center gap-2">
                  <label
                    className="relative grid size-10 shrink-0 cursor-pointer place-items-center overflow-hidden border border-accent-border/45 bg-primary shadow-[inset_0_1px_0_hsl(var(--accent-hue)_100%_90%/0.2)] focus-within:ring-2 focus-within:ring-ring/45"
                    aria-label="Choose fire color"
                  >
                    <input
                      id="accent-color"
                      type="color"
                      value={appearance.accentColor}
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
                      aria-label="Fire color hex value"
                      value={hexDraft}
                      onChange={updateHexDraft}
                      maxLength={7}
                      spellCheck={false}
                      className="h-10 font-mono uppercase"
                    />
                    <SaveIndicator state={saveState} />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-lg"
                    onClick={() =>
                      updateAppearance(
                        { ...appearance, accentColor: defaultAccentColor },
                        null
                      )
                    }
                    aria-label="Restore build default fire color"
                    title="Restore build default fire color"
                  >
                    <RotateCcw />
                  </Button>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                  The {nightlyDefault ? "nightly" : "stable"} build default is{" "}
                  {nightlyDefault ? "blue fire" : "hearth orange"}. Lightness is
                  normalized so text and controls retain predictable contrast.
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-foreground">
                  Fire presets
                </p>
                <div className="mt-2 grid grid-cols-5 gap-1.5">
                  {firePresets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      aria-pressed={
                        customAccentColor === preset.color.toLowerCase()
                      }
                      onClick={() => updateAccent(preset.color)}
                      className="group border bg-background/55 p-1.5 text-left transition-colors hover:border-accent-border/60 aria-pressed:border-primary aria-pressed:bg-primary/8"
                    >
                      <span
                        className="block h-7 border border-black/10"
                        style={{ backgroundColor: preset.color }}
                      />
                      <span className="mt-1.5 block truncate font-mono text-[8px] text-muted-foreground group-aria-pressed:text-primary">
                        {preset.label}
                      </span>
                    </button>
                  ))}
                </div>
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

function ModeButton({
  active,
  description,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  description: string
  icon: typeof Moon
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="flex items-center gap-3 border bg-background/50 px-3 py-2.5 text-left transition-colors hover:border-accent-border/55 aria-pressed:border-primary aria-pressed:bg-primary/8"
    >
      <Icon className="size-4 text-primary" aria-hidden="true" />
      <span>
        <span className="block text-xs font-medium">{label}</span>
        <span className="mt-0.5 block text-[9px] text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null
  return (
    <span
      className={`pointer-events-none absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1 font-mono text-[9px] uppercase ${
        state === "error" ? "text-destructive" : "text-primary"
      }`}
    >
      {state === "saved" ? <Check className="size-3" /> : null}
      {state === "saving" ? "Saving" : state === "saved" ? "Saved" : "Retry"}
    </span>
  )
}

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
          <span className="flex items-center gap-1 border border-primary/30 bg-primary/8 px-2 py-1 font-mono text-[8px] text-primary uppercase">
            <Flame className="size-3" aria-hidden="true" />
            Active
          </span>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="rounded-lg border bg-background/70 p-3">
          <p className="text-xs font-semibold">Neutral hierarchy</p>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Background, card, muted text, and borders carry a restrained trace
            of the selected fire hue in both surface modes.
          </p>
        </div>

        <div className="rounded-lg border border-accent-border/30 bg-popover bg-[image:var(--surface-gradient)] p-3 shadow-xl shadow-black/10 dark:shadow-black/30">
          <p className="text-xs font-semibold text-popover-foreground">
            Floating surface
          </p>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Tooltips and popovers use the same accent family instead of a
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
