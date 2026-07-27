import * as React from "react"
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { Check, Monitor, Moon, Plus, Sun } from "lucide-react"

import { ColorPicker } from "@workspace/ui/components/color-picker"
import { cn } from "@workspace/ui/lib/utils"

import {
  defaultAppearance,
  maximumCustomAccentColors,
  saveAppearanceCache,
} from "@/lib/appearance"
import type {
  AppearanceOverride,
  AppearancePreferences,
  ColorScheme,
} from "@/lib/appearance"
import { queryKeys, uiPreferencesQueryOptions } from "@/lib/query-options"
import { updateAppearancePreferences } from "@/server/preferences"

const persistDelay = 300
const presets = [
  { color: "#f97316", name: "Orange" },
  { color: "#ef4444", name: "Ember" },
  { color: "#f4ff3b", name: "Yellow" },
  { color: "#38bdf8", name: "Blue" },
  { color: "#f5f5f4", name: "White" },
] as const
const customColorSeeds = ["#497dff", "#14b8a6", "#d946ef"] as const

type AppearanceUpdate = AppearanceOverride & {
  defaultForNewUsers?: boolean
}

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
    const [customColors, setCustomColors] = React.useState<Array<string>>(
      uiPreferences.customColors
    )
    const nextCustomColorId = React.useRef(uiPreferences.customColors.length)
    const [customColorIds, setCustomColorIds] = React.useState<Array<string>>(
      () =>
        uiPreferences.customColors.map((_, index) => `custom-color-${index}`)
    )
    const [defaultForNewUsers, setDefaultForNewUsers] = React.useState(
      uiPreferences.defaultForNewUsers
    )
    const [activeCustomIndex, setActiveCustomIndex] = React.useState<
      number | null
    >(null)
    const persistTimeout = React.useRef<number | null>(null)
    const pendingUpdate = React.useRef<AppearanceUpdate | null>(null)

    const persist = React.useCallback(async (update: AppearanceUpdate) => {
      try {
        await updateAppearancePreferences({ data: update })
      } catch {
        // The local preference remains applied; the next change retries persistence.
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
      (
        next: AppearancePreferences,
        customColor: string | null,
        nextCustomColors = customColors
      ) => {
        if (!saveAppearanceCache(next)) return
        setAppearance(next)
        setCustomAccentColor(customColor)
        setCustomColors(nextCustomColors)
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
                  customColors: nextCustomColors,
                }
              : current
        )
        schedulePersist(
          persistedUpdate({
            accentColor: customColor,
            colorScheme: next.colorScheme,
            customColors: nextCustomColors,
          })
        )
      },
      [
        customColors,
        defaultForNewUsers,
        persistedUpdate,
        queryClient,
        schedulePersist,
      ]
    )

    const updateAccent = React.useCallback(
      (color: string, nextCustomColors = customColors) => {
        const normalizedColor = color.toLowerCase()
        updateAppearance(
          { ...appearance, accentColor: normalizedColor },
          normalizedColor,
          nextCustomColors
        )
      },
      [appearance, customColors, updateAppearance]
    )

    const updateColorScheme = React.useCallback(
      (colorScheme: ColorScheme) => {
        updateAppearance(
          { ...appearance, colorScheme },
          customAccentColor,
          customColors
        )
      },
      [appearance, customAccentColor, customColors, updateAppearance]
    )

    const addCustomColor = React.useCallback(() => {
      if (customColors.length >= maximumCustomAccentColors) return
      const seed =
        customColorSeeds.find((color) => !customColors.includes(color)) ??
        customColorSeeds[0]
      const nextCustomColors = [...customColors, seed]
      const customColorId = `custom-color-${nextCustomColorId.current}`
      nextCustomColorId.current += 1
      setCustomColorIds((currentIds) => [...currentIds, customColorId])
      setActiveCustomIndex(nextCustomColors.length - 1)
      updateAccent(seed, nextCustomColors)
    }, [customColors, updateAccent])

    const updateCustomColor = React.useCallback(
      (index: number, color: string) => {
        const nextCustomColors = customColors.map((customColor, colorIndex) =>
          colorIndex === index ? color.toLowerCase() : customColor
        )
        updateAccent(color, nextCustomColors)
      },
      [customColors, updateAccent]
    )

    const removeCustomColor = React.useCallback(
      (index: number) => {
        const removedColor = customColors[index]
        const nextCustomColors = customColors.filter(
          (_, colorIndex) => colorIndex !== index
        )
        setCustomColorIds((currentIds) =>
          currentIds.filter((_, colorIndex) => colorIndex !== index)
        )
        setActiveCustomIndex(null)
        if (appearance.accentColor === removedColor) {
          updateAppearance(
            {
              ...appearance,
              accentColor: uiPreferences.appearanceDefault.accentColor,
            },
            null,
            nextCustomColors
          )
          return
        }
        updateAppearance(appearance, customAccentColor, nextCustomColors)
      },
      [
        appearance,
        customAccentColor,
        customColors,
        uiPreferences.appearanceDefault.accentColor,
        updateAppearance,
      ]
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
        if (nextAppearance !== appearance) {
          saveAppearanceCache(nextAppearance)
          setAppearance(nextAppearance)
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
              customColors,
            },
            enabled
          )
        )
      },
      [
        appearance,
        customAccentColor,
        customColors,
        persistedUpdate,
        queryClient,
        schedulePersist,
      ]
    )

    return (
      <div className="w-full max-w-2xl px-5 pb-12">
        <section className="border-b">
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

          <AccentColorControl
            accentColor={appearance.accentColor}
            activeCustomIndex={activeCustomIndex}
            customColorIds={customColorIds}
            customColors={customColors}
            onAdd={addCustomColor}
            onCustomChange={updateCustomColor}
            onCustomOpenChange={setActiveCustomIndex}
            onCustomRemove={removeCustomColor}
            onSelect={updateAccent}
          />

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

function AccentColorControl({
  accentColor,
  activeCustomIndex,
  customColorIds,
  customColors,
  onAdd,
  onCustomChange,
  onCustomOpenChange,
  onCustomRemove,
  onSelect,
}: {
  accentColor: string
  activeCustomIndex: number | null
  customColorIds: Array<string>
  customColors: Array<string>
  onAdd: () => void
  onCustomChange: (index: number, color: string) => void
  onCustomOpenChange: (index: number | null) => void
  onCustomRemove: (index: number) => void
  onSelect: (color: string) => void
}) {
  return (
    <SettingRow label="Accent Color">
      <div className="flex max-w-md flex-wrap items-center gap-2">
        {presets.map((preset) => (
          <ColorSwatch
            key={preset.name}
            color={preset.color}
            label={preset.name}
            selected={accentColor === preset.color}
            onClick={() => onSelect(preset.color)}
          />
        ))}

        <span
          role="separator"
          aria-orientation="vertical"
          className="mx-1 h-7 w-px bg-border"
        />

        {customColors.map((color, index) => (
          <ColorPicker
            key={customColorIds[index]}
            value={color}
            onValueChange={(nextColor) => onCustomChange(index, nextColor)}
            onRemove={() => onCustomRemove(index)}
            open={activeCustomIndex === index}
            onOpenChange={(open) => onCustomOpenChange(open ? index : null)}
          >
            <ColorSwatch
              color={color}
              label={`Custom color ${index + 1}`}
              selected={accentColor === color}
              onClick={() => onSelect(color)}
            />
          </ColorPicker>
        ))}

        {customColors.length < maximumCustomAccentColors ? (
          <button
            type="button"
            aria-label="Add custom color"
            onClick={onAdd}
            className="grid size-9 place-items-center border border-dashed border-input bg-input/10 text-muted-foreground transition-[color,background-color,border-color,transform] outline-none hover:scale-105 hover:border-primary/50 hover:bg-primary/6 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/45"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </SettingRow>
  )
}

type ColorSwatchProps = Omit<
  React.ComponentPropsWithoutRef<"button">,
  "color"
> & {
  color: string
  label: string
  selected: boolean
}

const ColorSwatch = React.forwardRef<HTMLButtonElement, ColorSwatchProps>(
  function ColorSwatch(
    { className, color, label, selected, style, ...props },
    ref
  ) {
    return (
      <button
        ref={ref}
        type="button"
        {...props}
        aria-label={label}
        aria-pressed={selected}
        className={cn(
          "relative size-9 border border-black/15 transition-[border-color,box-shadow,transform] outline-none hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring/45 aria-pressed:border-primary aria-pressed:ring-2 aria-pressed:ring-primary/50 aria-pressed:ring-offset-2 aria-pressed:ring-offset-background",
          className
        )}
        style={{ ...style, backgroundColor: color }}
      >
        {selected ? (
          <span className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center border-2 border-background bg-primary text-primary-foreground shadow-sm">
            <Check className="size-2.5" aria-hidden="true" />
          </span>
        ) : null}
      </button>
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
        "relative h-7 w-12 border transition-[background-color,border-color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        checked
          ? "border-primary bg-primary"
          : "border-input bg-muted-foreground/20"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 size-[22px] bg-background shadow-sm transition-transform",
          checked ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  )
}
