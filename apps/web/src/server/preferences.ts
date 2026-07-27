import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import {
  appearanceCacheCookieName,
  defaultAccentColor,
  normalizeAppearanceOverride,
} from "@/lib/appearance"
import { selectedInstanceCookieName } from "@/lib/ui-preference-cookies"

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const FILE_TREE_COLLAPSED_COOKIE_NAME = "file_tree_collapsed"
const FILE_TREE_WIDTH_COOKIE_NAME = "file_tree_width"

function readCookie(cookies: string, name: string) {
  return cookies
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

export const getUiPreferences = createServerFn({ method: "GET" }).handler(
  async () => {
    const [
      { loadAppearanceOverrideEffect },
      { runAppEffect },
      { requireAuthenticatedUser },
      { getRequestHeaders, setCookie, setResponseHeader },
    ] = await Promise.all([
      import("@/effect/appearance-preferences"),
      import("@/effect/runtime"),
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
    ])
    const user = await requireAuthenticatedUser()
    const appearanceOverride = await runAppEffect(
      "appearancePreferences.load",
      loadAppearanceOverrideEffect(user.id)
    )
    const appearance = {
      accentColor: appearanceOverride.accentColor ?? defaultAccentColor,
      colorScheme: appearanceOverride.colorScheme,
    }
    setCookie(appearanceCacheCookieName, JSON.stringify(appearance), {
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
    })
    setResponseHeader("Cache-Control", "no-store")

    const cookies = getRequestHeaders().get("cookie") ?? ""
    const sidebarCookie = readCookie(cookies, SIDEBAR_COOKIE_NAME)
    const fileTreeCollapsedCookie = readCookie(
      cookies,
      FILE_TREE_COLLAPSED_COOKIE_NAME
    )
    const rawFileTreeWidth = Number(
      readCookie(cookies, FILE_TREE_WIDTH_COOKIE_NAME)
    )
    const fileTreeWidth =
      Number.isFinite(rawFileTreeWidth) &&
      rawFileTreeWidth >= 224 &&
      rawFileTreeWidth <= 480
        ? rawFileTreeWidth
        : null

    return {
      sidebarOpen: sidebarCookie !== "false",
      fileTreeCollapsed: fileTreeCollapsedCookie === "true",
      fileTreeWidth,
      selectedInstanceRouteId:
        readCookie(cookies, selectedInstanceCookieName) ?? null,
      appearance,
      customAccentColor: appearanceOverride.accentColor,
    }
  }
)

export const updateAppearancePreferences = createServerFn({ method: "POST" })
  .validator(
    z.object({
      accentColor: z
        .string()
        .regex(/^#[\da-f]{6}$/i)
        .nullable(),
      colorScheme: z.enum(["dark", "light"]),
    })
  )
  .handler(async ({ data }) => {
    const [
      { saveAppearanceOverrideEffect },
      { runAppEffect },
      { requireAuthenticatedUser },
      { setCookie, setResponseHeader },
    ] = await Promise.all([
      import("@/effect/appearance-preferences"),
      import("@/effect/runtime"),
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
    ])
    const user = await requireAuthenticatedUser()
    const appearanceOverride = normalizeAppearanceOverride(data)
    await runAppEffect(
      "appearancePreferences.save",
      saveAppearanceOverrideEffect(
        crypto.randomUUID(),
        user.id,
        appearanceOverride
      )
    )
    const appearance = {
      accentColor: appearanceOverride.accentColor ?? defaultAccentColor,
      colorScheme: appearanceOverride.colorScheme,
    }
    setCookie(appearanceCacheCookieName, JSON.stringify(appearance), {
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
    })
    setResponseHeader("Cache-Control", "no-store")
    return { appearance, customAccentColor: appearanceOverride.accentColor }
  })
