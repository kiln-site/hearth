export const appearanceCacheCookieName = "kiln_appearance"
export const stableDefaultAccentColor = "#f97316"
export const nightlyDefaultAccentColor = "#38bdf8"
export const maximumCustomAccentColors = 3

const appearanceCacheMaxAge = 60 * 60 * 24 * 365
const hexColorPattern = /^#[\da-f]{6}$/i

export type ColorScheme = "dark" | "light" | "system"
export type ResolvedColorScheme = Exclude<ColorScheme, "system">

export interface AppearancePreferences {
  accentColor: string
  colorScheme: ColorScheme
}

export interface AppearanceOverride {
  accentColor: string | null
  colorScheme: ColorScheme
  customColors: Array<string>
}

export type AccentHsl = {
  hue: number
  saturation: number
}

export function isNightlyVersion(version: string | undefined) {
  return version?.includes("-nightly.") ?? false
}

export function buildDefaultAccentColor(version: string | undefined) {
  return isNightlyVersion(version)
    ? nightlyDefaultAccentColor
    : stableDefaultAccentColor
}

export const defaultAccentColor = buildDefaultAccentColor(
  import.meta.env.VITE_KILN_VERSION
)
export const defaultColorScheme: ColorScheme = "system"

export const defaultAppearance: AppearancePreferences = {
  accentColor: defaultAccentColor,
  colorScheme: defaultColorScheme,
}

export function parseAccentColor(color: string): AccentHsl | null {
  if (!hexColorPattern.test(color)) return null

  const red = Number.parseInt(color.slice(1, 3), 16) / 255
  const green = Number.parseInt(color.slice(3, 5), 16) / 255
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  const delta = maximum - minimum
  const lightness = (maximum + minimum) / 2

  let hue = 0
  if (delta > 0) {
    if (maximum === red) hue = ((green - blue) / delta) % 6
    else if (maximum === green) hue = (blue - red) / delta + 2
    else hue = (red - green) / delta + 4
    hue *= 60
    if (hue < 0) hue += 360
  }

  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))

  return {
    hue: Math.round(hue * 10) / 10,
    saturation: Math.round(saturation * 1_000) / 10,
  }
}

export function normalizeAppearancePreferences(
  value: unknown,
  fallbackAccentColor = defaultAccentColor
): AppearancePreferences {
  if (!value || typeof value !== "object") {
    return {
      accentColor: fallbackAccentColor,
      colorScheme: defaultColorScheme,
    }
  }

  const accentColor =
    "accentColor" in value &&
    typeof value.accentColor === "string" &&
    hexColorPattern.test(value.accentColor)
      ? value.accentColor.toLowerCase()
      : fallbackAccentColor
  const colorScheme =
    "colorScheme" in value &&
    (value.colorScheme === "dark" ||
      value.colorScheme === "light" ||
      value.colorScheme === "system")
      ? value.colorScheme
      : defaultColorScheme

  return { accentColor, colorScheme }
}

export function normalizeAppearanceOverride(
  value: unknown
): AppearanceOverride {
  if (!value || typeof value !== "object") {
    return {
      accentColor: null,
      colorScheme: defaultColorScheme,
      customColors: [],
    }
  }

  const accentColor =
    "accentColor" in value &&
    typeof value.accentColor === "string" &&
    hexColorPattern.test(value.accentColor)
      ? value.accentColor.toLowerCase()
      : null
  const colorScheme =
    "colorScheme" in value &&
    (value.colorScheme === "dark" ||
      value.colorScheme === "light" ||
      value.colorScheme === "system")
      ? value.colorScheme
      : defaultColorScheme
  const customColors: Array<string> = []
  const customColorSet = new Set<string>()
  if ("customColors" in value && Array.isArray(value.customColors)) {
    for (const customColor of value.customColors) {
      if (
        typeof customColor !== "string" ||
        !hexColorPattern.test(customColor)
      ) {
        continue
      }
      const normalizedColor = customColor.toLowerCase()
      if (!customColorSet.has(normalizedColor)) {
        customColorSet.add(normalizedColor)
        customColors.push(normalizedColor)
      }
      if (customColors.length === maximumCustomAccentColors) break
    }
  }

  return { accentColor, colorScheme, customColors }
}

export function resolveAppearance(
  override: AppearanceOverride | null,
  platformDefault: AppearancePreferences | null
): AppearancePreferences {
  const fallback = platformDefault ?? defaultAppearance
  return {
    accentColor: override?.accentColor ?? fallback.accentColor,
    colorScheme: override?.colorScheme ?? fallback.colorScheme,
  }
}

export function resolveColorScheme(
  colorScheme: ColorScheme,
  prefersDark = systemPrefersDark()
): ResolvedColorScheme {
  return colorScheme === "system"
    ? prefersDark
      ? "dark"
      : "light"
    : colorScheme
}

function systemPrefersDark() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  )
}

export function applyAppearance(preferences: AppearancePreferences) {
  const accent = parseAccentColor(preferences.accentColor)
  if (!accent || typeof document === "undefined") return false

  const root = document.documentElement
  const colorScheme = resolveColorScheme(preferences.colorScheme)
  root.style.setProperty("--accent-hue", String(accent.hue))
  root.style.setProperty("--accent-saturation", `${accent.saturation}%`)
  root.classList.toggle("dark", colorScheme === "dark")
  root.classList.toggle("light", colorScheme === "light")
  return true
}

export function readAppearanceCache(): AppearancePreferences {
  if (typeof document === "undefined") {
    return {
      accentColor: defaultAccentColor,
      colorScheme: defaultColorScheme,
    }
  }

  const encodedPreferences = document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${appearanceCacheCookieName}=`))
    ?.slice(appearanceCacheCookieName.length + 1)

  if (!encodedPreferences) {
    return {
      accentColor: defaultAccentColor,
      colorScheme: defaultColorScheme,
    }
  }

  try {
    return normalizeAppearancePreferences(
      JSON.parse(decodeURIComponent(encodedPreferences))
    )
  } catch {
    return {
      accentColor: defaultAccentColor,
      colorScheme: defaultColorScheme,
    }
  }
}

export function saveAppearanceCache(preferences: AppearancePreferences) {
  const normalized = normalizeAppearancePreferences(preferences)
  if (!applyAppearance(normalized)) return false

  document.cookie = `${appearanceCacheCookieName}=${encodeURIComponent(
    JSON.stringify(normalized)
  )}; path=/; max-age=${appearanceCacheMaxAge}; SameSite=Lax`
  return true
}

export function clearAppearanceCache() {
  if (typeof document === "undefined") return
  document.cookie = `${appearanceCacheCookieName}=; path=/; max-age=0; SameSite=Lax`
  applyAppearance({
    accentColor: defaultAccentColor,
    colorScheme: defaultColorScheme,
  })
}

const bootDefault = JSON.stringify(defaultAppearance)

export const appearanceBootScript = `(()=>{try{const n="${appearanceCacheCookieName}=",e=document.cookie.split(";").map(e=>e.trim()).find(e=>e.startsWith(n));let t=${bootDefault};if(e)try{const n=JSON.parse(decodeURIComponent(e.slice(${appearanceCacheCookieName.length + 1})));if(n&&/^#[\\da-f]{6}$/i.test(n.accentColor)&&(n.colorScheme==="dark"||n.colorScheme==="light"||n.colorScheme==="system"))t=n}catch{}const c=t.accentColor,r=parseInt(c.slice(1,3),16)/255,o=parseInt(c.slice(3,5),16)/255,a=parseInt(c.slice(5,7),16)/255,s=Math.max(r,o,a),i=Math.min(r,o,a),l=s-i,d=(s+i)/2;let u=0;l>0&&(s===r?u=(o-a)/l%6:s===o?u=(a-r)/l+2:u=(r-o)/l+4,u*=60,u<0&&(u+=360));const m=l===0?0:l/(1-Math.abs(2*d-1)),p=document.documentElement,h=t.colorScheme==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t.colorScheme;p.style.setProperty("--accent-hue",String(Math.round(10*u)/10)),p.style.setProperty("--accent-saturation",Math.round(1e3*m)/10+"%"),p.classList.toggle("dark",h==="dark"),p.classList.toggle("light",h==="light")}catch{}})()`
