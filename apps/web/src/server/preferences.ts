import { createServerFn } from "@tanstack/react-start"

const SIDEBAR_COOKIE_NAME = "sidebar_state"

export const getUiPreferences = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getRequestHeaders } = await import("@tanstack/react-start/server")
    const cookies = getRequestHeaders().get("cookie") ?? ""
    const sidebarCookie = cookies
      .split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${SIDEBAR_COOKIE_NAME}=`))
      ?.slice(SIDEBAR_COOKIE_NAME.length + 1)

    return {
      sidebarOpen: sidebarCookie !== "false",
    }
  }
)
