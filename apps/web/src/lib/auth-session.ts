import type { AuthSession } from "@/lib/auth"

import { auth } from "@/lib/auth"
import { developmentBypassEnabled } from "@/lib/environment"

export const DEV_BYPASS_COOKIE = "kiln-dev-auth-bypass"

export interface AuthenticatedUser {
  email: string
  emailVerified: boolean
  id: string
  isDevelopmentBypass: boolean
  name: string
  role: "admin" | "user"
  twoFactorEnabled: boolean
}

export async function getSessionFromHeaders(
  headers: Headers
): Promise<AuthSession | null> {
  return auth.api.getSession({ headers })
}

export async function getAuthenticatedUserFromHeaders(
  headers: Headers
): Promise<AuthenticatedUser | null> {
  if (hasDevelopmentBypass(headers)) {
    return {
      email: "developer@kiln.local",
      emailVerified: true,
      id: "kiln-development-bypass",
      isDevelopmentBypass: true,
      name: "Kiln Developer",
      role: "admin",
      twoFactorEnabled: false,
    }
  }

  const session = await getSessionFromHeaders(headers)
  if (!session) return null
  return {
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    id: session.user.id,
    isDevelopmentBypass: false,
    name: session.user.name,
    role:
      (session.user as typeof session.user & { role?: string }).role === "admin"
        ? "admin"
        : "user",
    twoFactorEnabled:
      (session.user as typeof session.user & { twoFactorEnabled?: boolean })
        .twoFactorEnabled ?? false,
  }
}

export async function requireAuthenticatedUserFromHeaders(
  headers: Headers
): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUserFromHeaders(headers)
  if (!user) throw new Error("Authentication required")
  return user
}

export function hasDevelopmentBypass(headers: Headers): boolean {
  if (!developmentBypassEnabled()) return false
  const cookies = headers.get("cookie") ?? ""
  return cookies
    .split(";")
    .some((cookie) => cookie.trim() === `${DEV_BYPASS_COOKIE}=enabled`)
}
