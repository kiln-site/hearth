export const accentColorCookieName = "kiln_accent_color"
export const defaultAccentColor = "#f97316"

const accentColorCookieMaxAge = 60 * 60 * 24 * 365
const hexColorPattern = /^#[\da-f]{6}$/i

export type AccentHsl = {
  hue: number
  saturation: number
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

export function applyAccentColor(color: string) {
  const accent = parseAccentColor(color)
  if (!accent || typeof document === "undefined") return false

  document.documentElement.style.setProperty("--accent-hue", String(accent.hue))
  document.documentElement.style.setProperty(
    "--accent-saturation",
    `${accent.saturation}%`
  )
  return true
}

export function readAccentColor() {
  if (typeof document === "undefined") return defaultAccentColor

  const encodedColor = document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${accentColorCookieName}=`))
    ?.slice(accentColorCookieName.length + 1)

  if (!encodedColor) return defaultAccentColor

  try {
    const color = decodeURIComponent(encodedColor)
    return hexColorPattern.test(color)
      ? color.toLowerCase()
      : defaultAccentColor
  } catch {
    return defaultAccentColor
  }
}

export function saveAccentColor(color: string) {
  if (!applyAccentColor(color)) return false

  document.cookie = `${accentColorCookieName}=${encodeURIComponent(
    color.toLowerCase()
  )}; path=/; max-age=${accentColorCookieMaxAge}; SameSite=Lax`
  return true
}

export const accentColorBootScript =
  '(()=>{try{const e=document.cookie.split(";").map(e=>e.trim()).find(e=>e.startsWith("kiln_accent_color="));if(!e)return;const t=decodeURIComponent(e.slice(18));if(!/^#[\\da-f]{6}$/i.test(t))return;const c=parseInt(t.slice(1,3),16)/255,n=parseInt(t.slice(3,5),16)/255,o=parseInt(t.slice(5,7),16)/255,r=Math.max(c,n,o),a=Math.min(c,n,o),l=r-a,s=(r+a)/2;let i=0;l>0&&(r===c?i=(n-o)/l%6:r===n?i=(o-c)/l+2:i=(c-n)/l+4,i*=60,i<0&&(i+=360));const d=l===0?0:l/(1-Math.abs(2*s-1)),u=document.documentElement;u.style.setProperty("--accent-hue",String(Math.round(10*i)/10)),u.style.setProperty("--accent-saturation",`${Math.round(1e3*d)/10}%`)}catch{}})()'
