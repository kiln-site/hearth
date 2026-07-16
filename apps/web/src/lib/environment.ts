import { parseSecretKeyring } from "../../keyring.mjs"
import type { VersionedSecret } from "../../keyring.mjs"

export interface EmailDeliveryConfig {
  apiKey: string
  from: string
}

export type KilnEnvironment = "dev" | "prod"

const DEFAULT_TRUSTED_ORIGINS = [
  "http://localhost:3000",
  "https://hearth.kiln.site",
  "https://hearth.hearth.orb.local",
] as const

export function kilnEnvironment(): KilnEnvironment {
  return parseKilnEnvironment(process.env.KILN_ENVIRONMENT)
}

export function developmentBypassEnabled(): boolean {
  return kilnEnvironment() === "dev"
}

export function betterAuthSecrets(): Array<VersionedSecret> {
  return parseSecretKeyring(process.env.BETTER_AUTH_SECRETS)
}

function parseKilnEnvironment(value: string | undefined): KilnEnvironment {
  const configured = value?.trim().toLowerCase()
  if (!configured) return "prod"
  if (configured === "dev" || configured === "prod") return configured
  throw new Error("KILN_ENVIRONMENT must be dev or prod")
}

export function kilnPublicUrl(): URL {
  const configured = process.env.KILN_URL?.trim() || "http://localhost:3000"

  try {
    return new URL(configured)
  } catch {
    throw new Error("KILN_URL must be an absolute http or https URL")
  }
}

export function betterAuthUrl(): URL {
  const configured = process.env.BETTER_AUTH_URL?.trim()
  if (!configured) return kilnPublicUrl()
  try {
    return new URL(configured)
  } catch {
    throw new Error("BETTER_AUTH_URL must be an absolute http or https URL")
  }
}

export function publicSignupEnabled(): boolean {
  return environmentFlag("KILN_ENABLE_SIGNUPS", false)
}

export function emailDeliveryConfig(): EmailDeliveryConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.RESEND_FROM_EMAIL?.trim()
  return apiKey && from ? { apiKey, from } : null
}

export function parseTrustedOrigins(
  ...baseOrigins: Array<string>
): Array<string> {
  const configured = process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
  return Array.from(
    new Set([...baseOrigins, ...DEFAULT_TRUSTED_ORIGINS, ...(configured ?? [])])
  )
}

export function relayKey(): string | null {
  return process.env.KILN_RELAY_KEY?.trim() || null
}

function environmentFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim()
  if (!value) return fallback
  if (/^(?:1|true|yes|on)$/iu.test(value)) return true
  if (/^(?:0|false|no|off)$/iu.test(value)) return false
  throw new Error(`${name} must be true or false`)
}
