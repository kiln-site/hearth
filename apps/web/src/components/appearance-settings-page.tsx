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
import type { UiPreferences } from "@/lib/query-options"
import { updateAppearancePreferences } from "@/server/preferences"

const persistDelay = 300
const defaultPreset = { color: "#f97316", name: "Orange" } as const
const presets = [
  { color: "#ef4444", name: "Ember" },
  { color: "#f4ff3b", name: "Yellow" },
  { color: "#38bdf8", name: "Blue" },
  { color: "#f5f5f4", name: "White" },
] as const
const customColorSeeds = ["#497dff", "#14b8a6", "#d946ef"] as const

type AppearanceUpdate = AppearanceOverride & {
  defaultForNewUsers?: boolean
}

function selectAppearanceSettingsPreferences(preferences: UiPreferences) {
  return {
    appearance: preferences.appearance,
    canManageAppearanceDefault: preferences.canManageAppearanceDefault,
    customAccentColor: preferences.customAccentColor,
    customColors: preferences.customColors,
  }
}

function useAppearanceSettings() {
  const queryClient = useQueryClient()
  const uiPreferencesOptions = uiPreferencesQueryOptions()
  const { data: uiPreferences } = useSuspenseQuery({
    ...uiPreferencesOptions,
    select: selectAppearanceSettingsPreferences,
  })
  const initialPreferences = queryClient.getQueryData(
    uiPreferencesOptions.queryKey
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
    () => uiPreferences.customColors.map((_, index) => `custom-color-${index}`)
  )
  const [activeCustomIndex, setActiveCustomIndex] = React.useState<
    number | null
  >(null)
  const appearanceRef = React.useRef(appearance)
  const customAccentColorRef = React.useRef(customAccentColor)
  const customColorsRef = React.useRef(customColors)
  const defaultForNewUsersRef = React.useRef(
    initialPreferences?.defaultForNewUsers ?? false
  )
  const appearanceDefaultAccentColorRef = React.useRef(
    initialPreferences?.appearanceDefault.accentColor ??
      defaultAppearance.accentColor
  )
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
      nextDefaultForNewUsers = defaultForNewUsersRef.current
    ): AppearanceUpdate => ({
      ...override,
      ...(uiPreferences.canManageAppearanceDefault
        ? { defaultForNewUsers: nextDefaultForNewUsers }
        : {}),
    }),
    [uiPreferences.canManageAppearanceDefault]
  )

  const updateAppearance = React.useCallback(
    (
      next: AppearancePreferences,
      customColor: string | null,
      nextCustomColors = customColorsRef.current
    ) => {
      const currentAppearance = appearanceRef.current
      const appearanceChanged =
        currentAppearance.accentColor !== next.accentColor ||
        currentAppearance.colorScheme !== next.colorScheme
      const customAccentChanged = customAccentColorRef.current !== customColor
      const customColorsChanged = customColorsRef.current !== nextCustomColors

      if (!appearanceChanged && !customAccentChanged && !customColorsChanged) {
        return
      }
      if (appearanceChanged && !saveAppearanceCache(next)) return

      const resolvedAppearance = appearanceChanged ? next : currentAppearance
      appearanceRef.current = resolvedAppearance
      customAccentColorRef.current = customColor
      customColorsRef.current = nextCustomColors
      if (appearanceChanged) setAppearance(resolvedAppearance)
      if (customAccentChanged) setCustomAccentColor(customColor)
      if (customColorsChanged) setCustomColors(nextCustomColors)

      queryClient.setQueryData<UiPreferences>(
        queryKeys.uiPreferences,
        (current) =>
          current
            ? {
                ...current,
                appearance: resolvedAppearance,
                appearanceDefault: defaultForNewUsersRef.current
                  ? resolvedAppearance
                  : current.appearanceDefault,
                customAccentColor: customColor,
                customColors: nextCustomColors,
              }
            : current
      )
      schedulePersist(
        persistedUpdate({
          accentColor: customColor,
          colorScheme: resolvedAppearance.colorScheme,
          customColors: nextCustomColors,
        })
      )
    },
    [persistedUpdate, queryClient, schedulePersist]
  )

  const updateAccent = React.useCallback(
    (color: string, nextCustomColors = customColorsRef.current) => {
      const normalizedColor = color.toLowerCase()
      const currentAppearance = appearanceRef.current
      updateAppearance(
        { ...currentAppearance, accentColor: normalizedColor },
        normalizedColor,
        nextCustomColors
      )
    },
    [updateAppearance]
  )

  const updateColorScheme = React.useCallback(
    (colorScheme: ColorScheme) => {
      const currentAppearance = appearanceRef.current
      updateAppearance(
        { ...currentAppearance, colorScheme },
        customAccentColorRef.current,
        customColorsRef.current
      )
    },
    [updateAppearance]
  )

  const addCustomColor = React.useCallback(() => {
    const currentCustomColors = customColorsRef.current
    if (currentCustomColors.length >= maximumCustomAccentColors) return
    const seed =
      customColorSeeds.find((color) => !currentCustomColors.includes(color)) ??
      customColorSeeds[0]
    const nextCustomColors = [...currentCustomColors, seed]
    const customColorId = `custom-color-${nextCustomColorId.current}`
    nextCustomColorId.current += 1
    setCustomColorIds((currentIds) => [...currentIds, customColorId])
    setActiveCustomIndex(nextCustomColors.length - 1)
    updateAccent(seed, nextCustomColors)
  }, [updateAccent])

  const updateCustomColor = React.useCallback(
    (index: number, color: string) => {
      const nextCustomColors = customColorsRef.current.map(
        (customColor, colorIndex) =>
          colorIndex === index ? color.toLowerCase() : customColor
      )
      updateAccent(color, nextCustomColors)
    },
    [updateAccent]
  )

  const removeCustomColor = React.useCallback(
    (index: number) => {
      const currentAppearance = appearanceRef.current
      const currentCustomColors = customColorsRef.current
      const removedColor = currentCustomColors[index]
      const nextCustomColors = currentCustomColors.filter(
        (_, colorIndex) => colorIndex !== index
      )
      setCustomColorIds((currentIds) =>
        currentIds.filter((_, colorIndex) => colorIndex !== index)
      )
      setActiveCustomIndex(null)
      if (currentAppearance.accentColor === removedColor) {
        updateAppearance(
          {
            ...currentAppearance,
            accentColor: appearanceDefaultAccentColorRef.current,
          },
          null,
          nextCustomColors
        )
        return
      }
      updateAppearance(
        currentAppearance,
        customAccentColorRef.current,
        nextCustomColors
      )
    },
    [updateAppearance]
  )

  const updateDefaultForNewUsers = React.useCallback(
    (enabled: boolean) => {
      const currentAppearance = appearanceRef.current
      const shouldResetAccent =
        !enabled &&
        customAccentColorRef.current === null &&
        currentAppearance.accentColor !== defaultAppearance.accentColor
      const nextAppearance = shouldResetAccent
        ? {
            ...currentAppearance,
            accentColor: defaultAppearance.accentColor,
          }
        : currentAppearance
      const nextAppearanceDefault = enabled
        ? currentAppearance
        : defaultAppearance

      defaultForNewUsersRef.current = enabled
      appearanceDefaultAccentColorRef.current =
        nextAppearanceDefault.accentColor
      if (shouldResetAccent && saveAppearanceCache(nextAppearance)) {
        appearanceRef.current = nextAppearance
        setAppearance(nextAppearance)
      }
      queryClient.setQueryData<UiPreferences>(
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
            accentColor: customAccentColorRef.current,
            colorScheme: currentAppearance.colorScheme,
            customColors: customColorsRef.current,
          },
          enabled
        )
      )
    },
    [persistedUpdate, queryClient, schedulePersist]
  )

  return {
    activeCustomIndex,
    appearance,
    canManageAppearanceDefault: uiPreferences.canManageAppearanceDefault,
    customColorIds,
    customColors,
    defaultForNewUsers: defaultForNewUsersRef.current,
    setActiveCustomIndex,
    addCustomColor,
    removeCustomColor,
    updateAccent,
    updateColorScheme,
    updateCustomColor,
    updateDefaultForNewUsers,
  }
}

export const AppearanceSettingsPage = React.memo(
  function AppearanceSettingsPage() {
    const settings = useAppearanceSettings()

    return (
      <div className="w-full max-w-2xl px-5 pb-12">
        <section className="border-b">
          <ModeControl
            colorScheme={settings.appearance.colorScheme}
            onSelect={settings.updateColorScheme}
          />

          <AccentColorControl
            accentColor={settings.appearance.accentColor}
            activeCustomIndex={settings.activeCustomIndex}
            customColorIds={settings.customColorIds}
            customColors={settings.customColors}
            onAdd={settings.addCustomColor}
            onCustomChange={settings.updateCustomColor}
            onCustomOpenChange={settings.setActiveCustomIndex}
            onCustomRemove={settings.removeCustomColor}
            onSelect={settings.updateAccent}
          />

          {settings.canManageAppearanceDefault ? (
            <SettingRow label="Default for new users">
              <DefaultForNewUsersSwitch
                initialChecked={settings.defaultForNewUsers}
                onCheckedChange={settings.updateDefaultForNewUsers}
              />
            </SettingRow>
          ) : null}
        </section>
      </div>
    )
  }
)

const AccentColorControl = React.memo(function AccentColorControl({
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
      <div className="flex max-w-md flex-wrap items-stretch gap-x-3 gap-y-4">
        <SwatchGroup label="Default">
          <PresetColorSwatch
            preset={defaultPreset}
            selected={accentColor === defaultPreset.color}
            onSelect={onSelect}
          />
        </SwatchGroup>

        <SwatchGroup label="Preset" separated>
          {presets.map((preset) => (
            <PresetColorSwatch
              key={preset.name}
              preset={preset}
              selected={accentColor === preset.color}
              onSelect={onSelect}
            />
          ))}
        </SwatchGroup>

        <SwatchGroup label="Custom" separated>
          {customColors.map((color, index) => (
            <CustomColorControl
              key={customColorIds[index]}
              color={color}
              index={index}
              open={activeCustomIndex === index}
              selected={accentColor === color}
              onChange={onCustomChange}
              onOpenChange={onCustomOpenChange}
              onRemove={onCustomRemove}
              onSelect={onSelect}
            />
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
        </SwatchGroup>
      </div>
    </SettingRow>
  )
})

function SwatchGroup({
  children,
  label,
  separated = false,
}: {
  children: React.ReactNode
  label: string
  separated?: boolean
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "relative flex min-w-0 flex-col gap-2",
        separated && "pl-3"
      )}
    >
      {separated ? (
        <span
          role="separator"
          aria-orientation="vertical"
          className="absolute inset-y-0 left-0 w-px bg-border"
        />
      ) : null}
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        {children}
      </div>
      <p className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </p>
    </div>
  )
}

const PresetColorSwatch = React.memo(function PresetColorSwatch({
  onSelect,
  preset,
  selected,
}: {
  onSelect: (color: string) => void
  preset: (typeof presets)[number] | typeof defaultPreset
  selected: boolean
}) {
  const select = React.useCallback(
    () => onSelect(preset.color),
    [onSelect, preset.color]
  )

  return (
    <ColorSwatch
      color={preset.color}
      label={preset.name}
      selected={selected}
      onClick={select}
    />
  )
})

const CustomColorControl = React.memo(function CustomColorControl({
  color,
  index,
  onChange,
  onOpenChange,
  onRemove,
  onSelect,
  open,
  selected,
}: {
  color: string
  index: number
  onChange: (index: number, color: string) => void
  onOpenChange: (index: number | null) => void
  onRemove: (index: number) => void
  onSelect: (color: string) => void
  open: boolean
  selected: boolean
}) {
  const change = React.useCallback(
    (nextColor: string) => onChange(index, nextColor),
    [index, onChange]
  )
  const changeOpen = React.useCallback(
    (nextOpen: boolean) => onOpenChange(nextOpen ? index : null),
    [index, onOpenChange]
  )
  const remove = React.useCallback(() => onRemove(index), [index, onRemove])
  const select = React.useCallback(() => onSelect(color), [color, onSelect])

  return (
    <ColorPicker
      defaultValue={color}
      onValueChange={change}
      onRemove={remove}
      open={open}
      onOpenChange={changeOpen}
    >
      <ColorSwatch
        color={color}
        label={`Custom color ${index + 1}`}
        selected={selected}
        onClick={select}
      />
    </ColorPicker>
  )
})

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

const ModeControl = React.memo(function ModeControl({
  colorScheme,
  onSelect,
}: {
  colorScheme: ColorScheme
  onSelect: (colorScheme: ColorScheme) => void
}) {
  return (
    <SettingRow label="Mode">
      <div className="grid max-w-md grid-cols-3 gap-1.5">
        <ModeButton
          active={colorScheme === "dark"}
          colorScheme="dark"
          icon={Moon}
          label="Dark"
          onSelect={onSelect}
        />
        <ModeButton
          active={colorScheme === "light"}
          colorScheme="light"
          icon={Sun}
          label="Light"
          onSelect={onSelect}
        />
        <ModeButton
          active={colorScheme === "system"}
          colorScheme="system"
          icon={Monitor}
          label="System"
          onSelect={onSelect}
        />
      </div>
    </SettingRow>
  )
})

const ModeButton = React.memo(function ModeButton({
  active,
  colorScheme,
  icon: Icon,
  label,
  onSelect,
}: {
  active: boolean
  colorScheme: ColorScheme
  icon: typeof Moon
  label: string
  onSelect: (colorScheme: ColorScheme) => void
}) {
  const select = React.useCallback(
    () => onSelect(colorScheme),
    [colorScheme, onSelect]
  )

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={select}
      className="flex h-9 items-center justify-center gap-2 border bg-input/15 px-2 text-xs font-medium text-muted-foreground transition-[color,background-color,border-color,box-shadow] outline-none hover:border-primary/35 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35 aria-pressed:border-primary/55 aria-pressed:bg-primary/8 aria-pressed:text-primary"
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
})

/*
 * This switch owns its visual state so changing the platform default does not
 * re-render the appearance form. The parent callback only updates persistence
 * and query-cache fields excluded by the active UI selectors.
 */
const DefaultForNewUsersSwitch = React.memo(function DefaultForNewUsersSwitch({
  initialChecked,
  onCheckedChange,
}: {
  initialChecked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const [checked, setChecked] = React.useState(initialChecked)
  const checkedRef = React.useRef(initialChecked)
  const toggle = React.useCallback(() => {
    const next = !checkedRef.current
    checkedRef.current = next
    setChecked(next)
    onCheckedChange(next)
  }, [onCheckedChange])

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Default for new users"
      onClick={toggle}
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
})
