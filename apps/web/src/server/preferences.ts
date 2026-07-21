import { createServerFn } from "@tanstack/react-start"

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
    const { getRequestHeaders } = await import("@tanstack/react-start/server")
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
    }
  }
)
