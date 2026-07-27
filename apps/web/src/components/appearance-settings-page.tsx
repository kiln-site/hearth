import * as React from "react"
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { Check, Monitor, Moon, RotateCcw, Sun } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import { defaultAppearance, saveAppearanceCache } from "@/lib/appearance"
import type {
  AppearanceOverride,
  AppearancePreferences,
  ColorScheme,
} from "@/lib/appearance"
import { queryKeys, uiPreferencesQueryOptions } from "@/lib/query-options"
import { updateAppearancePreferences } from "@/server/preferences"

const persistDelay = 300
const presets = [
  { color: "#ef4444", name: "Ember" },
  { color: "#f97316", name: "Orange" },
  { color: "#eab308", name: "Gold" },
  { color: "#38bdf8", name: "Blue" },
  { color: "#f5f5f4", name: "White" },
] as const

type AppearanceUpdate = AppearanceOverride & {
  defaultForNewUsers?: boolean
}
type SaveState = "idle" | "saving" | "saved" | "error"

export const AppearanceSettingsPage = React.memo(
  function AppearanceSettingsPage() {
    const queryClient = useQueryClient()
    const { data: uiPreferences } = useSuspenseQuery(
      uiPreferencesQueryOptions()
    )
    const [appearance, setAppearance] = React.useState<AppearancePreferences>(
      uiPreferences.appearance
    )
    const [customAccentColor, setCustomAccentColor] = React.useState<
      string | null
    >(uiPreferences.customAccentColor)
    const [defaultForNewUsers, setDefaultForNewUsers] = React.useState(
      uiPreferences.defaultForNewUsers
    )
    const [appearanceDefault, setAppearanceDefault] =
      React.useState<AppearancePreferences>(uiPreferences.appearanceDefault)
    const [hexDraft, setHexDraft] = React.useState(appearance.accentColor)
    const [saveState, setSaveState] = React.useState<SaveState>("idle")
    const persistTimeout = React.useRef<number | null>(null)
    const pendingUpdate = React.useRef<AppearanceUpdate | null>(null)
    const savedTimeout = React.useRef<number | null>(null)

    const persist = React.useCallback(async (update: AppearanceUpdate) => {
      setSaveState("saving")
      try {
        await updateAppearancePreferences({ data: update })
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
      (update: AppearanceUpdate) => {
        pendingUpdate.current = update
        if (persistTimeout.current !== null) {
          window.clearTimeout(persistTimeout.current)
        }
        persistTimeout.current = window.setTimeout(() => {
          persistTimeout.current = null
          const pending = pendingUpdate.current
          pendingUpdate.current = null
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
          const pending = pendingUpdate.current
          if (pending) {
            void updateAppearancePreferences({ data: pending })
          }
        }
      }
    }, [])

    const persistedUpdate = React.useCallback(
      (
        override: AppearanceOverride,
        nextDefaultForNewUsers = defaultForNewUsers
      ): AppearanceUpdate => ({
        ...override,
        ...(uiPreferences.canManageAppearanceDefault
          ? { defaultForNewUsers: nextDefaultForNewUsers }
          : {}),
      }),
      [defaultForNewUsers, uiPreferences.canManageAppearanceDefault]
    )

    const updateAppearance = React.useCallback(
      (next: AppearancePreferences, customColor: string | null) => {
        if (!saveAppearanceCache(next)) return
        setAppearance(next)
        setCustomAccentColor(customColor)
        setHexDraft(next.accentColor)
        if (defaultForNewUsers) setAppearanceDefault(next)
        queryClient.setQueryData<typeof uiPreferences>(
          queryKeys.uiPreferences,
          (current) =>
            current
              ? {
                  ...current,
                  appearance: next,
                  appearanceDefault: defaultForNewUsers
                    ? next
                    : current.appearanceDefault,
                  customAccentColor: customColor,
                }
              : current
        )
        schedulePersist(
          persistedUpdate({
            accentColor: customColor,
            colorScheme: next.colorScheme,
          })
        )
      },
      [defaultForNewUsers, persistedUpdate, queryClient, schedulePersist]
    )

    const updateAccent = React.useCallback(
      (color: string) => {
        const normalizedColor = color.toLowerCase()
        updateAppearance(
          { ...appearance, accentColor: normalizedColor },
          normalizedColor
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

    const updateDefaultForNewUsers = React.useCallback(
      (enabled: boolean) => {
        const nextAppearance =
          !enabled && customAccentColor === null
            ? {
                ...appearance,
                accentColor: defaultAppearance.accentColor,
              }
            : appearance
        const nextAppearanceDefault = enabled ? appearance : defaultAppearance
        setDefaultForNewUsers(enabled)
        setAppearanceDefault(nextAppearanceDefault)
        if (nextAppearance !== appearance) {
          saveAppearanceCache(nextAppearance)
          setAppearance(nextAppearance)
          setHexDraft(nextAppearance.accentColor)
        }
        queryClient.setQueryData<typeof uiPreferences>(
          queryKeys.uiPreferences,
          (current) =>
            current
              ? {
                  ...current,
                  appearance: nextAppearance,
                  appearanceDefault: nextAppearanceDefault,
                  defaultForNewUsers: enabled,
                }
              : current
        )
        schedulePersist(
          persistedUpdate(
            {
              accentColor: customAccentColor,
              colorScheme: appearance.colorScheme,
            },
            enabled
          )
        )
      },
      [
        appearance,
        customAccentColor,
        persistedUpdate,
        queryClient,
        schedulePersist,
      ]
    )

    return (
      <div className="w-full max-w-2xl px-5 pb-12">
        <div className="flex h-5 items-center justify-end">
          <SaveIndicator state={saveState} />
        </div>

        <section className="border-y">
          <SettingRow label="Mode">
            <div className="grid max-w-md grid-cols-3 gap-1.5">
              <ModeButton
                active={appearance.colorScheme === "system"}
                icon={Monitor}
                label="System"
                onClick={() => updateColorScheme("system")}
              />
              <ModeButton
                active={appearance.colorScheme === "dark"}
                icon={Moon}
                label="Dark"
                onClick={() => updateColorScheme("dark")}
              />
              <ModeButton
                active={appearance.colorScheme === "light"}
                icon={Sun}
                label="Light"
                onClick={() => updateColorScheme("light")}
              />
            </div>
          </SettingRow>

          <SettingRow label="Accent color">
            <div className="flex max-w-md items-center gap-2">
              <input
                aria-label="Choose accent color"
                type="color"
                value={
                  /^#[\da-f]{6}$/i.test(hexDraft)
                    ? hexDraft
                    : appearance.accentColor
                }
                onChange={(event) => updateAccent(event.target.value)}
                className="size-9 shrink-0 cursor-pointer border border-input bg-input/20 p-1 transition-[border-color,box-shadow] outline-none hover:border-primary/40 focus-visible:border-ring/75 focus-visible:ring-2 focus-visible:ring-ring/35 [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
              />
              <Input
                aria-label="Accent color hex value"
                value={hexDraft}
                onChange={updateHexDraft}
                maxLength={7}
                spellCheck={false}
                className="h-9 min-w-0 font-mono uppercase"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-lg"
                    onClick={() =>
                      updateAppearance(
                        {
                          ...appearance,
                          accentColor: appearanceDefault.accentColor,
                        },
                        null
                      )
                    }
                    aria-label="Reset to Default"
                  >
                    <RotateCcw />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  Reset to Default
                </TooltipContent>
              </Tooltip>
            </div>
          </SettingRow>

          <SettingRow label="Preset">
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  aria-label={preset.name}
                  aria-pressed={
                    appearance.accentColor === preset.color.toLowerCase()
                  }
                  onClick={() => updateAccent(preset.color)}
                  className="relative size-9 border border-black/10 transition-[border-color,box-shadow,transform] outline-none hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring/45 aria-pressed:border-foreground/70 aria-pressed:ring-2 aria-pressed:ring-primary/35"
                  style={{ backgroundColor: preset.color }}
                >
                  <span className="sr-only">{preset.name}</span>
                </button>
              ))}
            </div>
          </SettingRow>

          {uiPreferences.canManageAppearanceDefault ? (
            <SettingRow label="Default for new users">
              <Switch
                checked={defaultForNewUsers}
                onCheckedChange={updateDefaultForNewUsers}
              />
            </SettingRow>
          ) : null}
        </section>
      </div>
    )
  }
)

function SettingRow({
  children,
  label,
}: {
  children: React.ReactNode
  label: string
}) {
  return (
    <div className="grid gap-3 border-b py-5 last:border-b-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
      <p className="text-xs font-medium text-foreground">{label}</p>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function ModeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon: typeof Moon
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="flex h-9 items-center justify-center gap-2 border bg-input/15 px-2 text-xs font-medium text-muted-foreground transition-[color,background-color,border-color,box-shadow] outline-none hover:border-primary/35 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35 aria-pressed:border-primary/55 aria-pressed:bg-primary/8 aria-pressed:text-primary"
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}

function Switch({
  checked,
  onCheckedChange,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Default for new users"
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-5 w-9 border transition-[background-color,border-color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        checked
          ? "border-primary bg-primary"
          : "border-input bg-muted-foreground/20"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-3.5 bg-background shadow-sm transition-transform",
          checked ? "translate-x-[17px]" : "translate-x-0.5"
        )}
      />
    </button>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null
  return (
    <span
      aria-live="polite"
      className={cn(
        "flex items-center gap-1 font-mono text-[9px] tracking-wide uppercase",
        state === "error" ? "text-destructive" : "text-primary"
      )}
    >
      {state === "saved" ? <Check className="size-3" /> : null}
      {state === "saving" ? "Saving" : state === "saved" ? "Saved" : "Retry"}
    </span>
  )
}
