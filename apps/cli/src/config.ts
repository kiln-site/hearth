import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { Effect } from "effect"
import { z } from "zod"

import { commandError } from "./errors.js"

export const DEFAULT_KILN_URL = "https://kiln.site"

const profileSchema = z.object({
  token: z.string().startsWith("kiln_cli_"),
  url: z.url(),
})

const configSchema = z.object({
  activeProfile: z.string().min(1).default("default"),
  profiles: z.record(z.string(), profileSchema).default({}),
  version: z.literal(1),
})

type KilnConfig = z.infer<typeof configSchema>

export interface KilnSession {
  profile: string
  token: string
  url: string
}

const emptyConfig: KilnConfig = {
  activeProfile: "default",
  profiles: {},
  version: 1,
}

export const loadConfigEffect = Effect.fn("cli.config.load")(function* () {
  const path = configPath()
  const encoded = yield* Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) => cause,
  }).pipe(Effect.option)
  if (encoded._tag === "None") return emptyConfig
  return yield* Effect.try({
    try: () => configSchema.parse(JSON.parse(encoded.value)),
    catch: (cause) =>
      commandError({
        cause,
        code: "invalid_config",
        exitCode: 2,
        message: `Kiln config at ${path} is invalid.`,
      }),
  })
})

export const resolveSessionEffect = Effect.fn("cli.config.resolveSession")(
  function* (input: { profile?: string; token?: string; url?: string }) {
    const config = yield* loadConfigEffect()
    const profile = input.profile || config.activeProfile || "default"
    const stored = config.profiles[profile]
    const token = input.token || process.env.KILN_TOKEN?.trim() || stored?.token
    const url = normalizeKilnUrl(
      input.url ||
        process.env.KILN_URL?.trim() ||
        stored?.url ||
        DEFAULT_KILN_URL
    )
    if (!token) {
      return yield* commandError({
        code: "authentication_required",
        exitCode: 3,
        message: "Run `kiln login` or provide KILN_TOKEN.",
      })
    }
    return { profile, token, url } satisfies KilnSession
  }
)

export const saveSessionEffect = Effect.fn("cli.config.saveSession")(function* (
  session: KilnSession
) {
  const config = yield* loadConfigEffect()
  const next: KilnConfig = {
    activeProfile: session.profile,
    profiles: {
      ...config.profiles,
      [session.profile]: { token: session.token, url: session.url },
    },
    version: 1,
  }
  yield* writeConfigEffect(next)
})

export const removeSessionEffect = Effect.fn("cli.config.removeSession")(
  function* (profileName?: string) {
    const config = yield* loadConfigEffect()
    const profile = profileName || config.activeProfile || "default"
    const profiles = Object.fromEntries(
      Object.entries(config.profiles).filter(([name]) => name !== profile)
    )
    yield* writeConfigEffect({
      activeProfile:
        config.activeProfile === profile ? "default" : config.activeProfile,
      profiles,
      version: 1,
    })
    return { profile, removed: Boolean(config.profiles[profile]) }
  }
)

export function normalizeKilnUrl(input: string): string {
  const candidate = /^[a-z][a-z\d+.-]*:\/\//iu.test(input)
    ? input
    : `https://${input}`
  const parsed = z.url().safeParse(candidate)
  if (!parsed.success) {
    throw commandError({
      code: "invalid_url",
      exitCode: 2,
      message: "Kiln URL must be an absolute HTTP or HTTPS URL.",
    })
  }
  const url = new URL(parsed.data)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw commandError({
      code: "invalid_url",
      exitCode: 2,
      message: "Kiln URL must use HTTP or HTTPS.",
    })
  }
  return url.toString().replace(/\/$/u, "")
}

function configPath(): string {
  const configured = process.env.KILN_CONFIG?.trim()
  if (configured) return configured
  const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config")
  return join(base, "kiln", "config.json")
}

function writeConfigEffect(config: KilnConfig) {
  const path = configPath()
  const temporary = `${path}.tmp-${process.pid}`
  return Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
        mode: 0o600,
      })
      await chmod(temporary, 0o600)
      await rename(temporary, path)
    },
    catch: (cause) =>
      commandError({
        cause,
        code: "config_write_failed",
        message: `Could not write Kiln config at ${path}.`,
      }),
  }).pipe(
    Effect.ensuring(
      Effect.tryPromise({
        try: () => unlink(temporary),
        catch: () => undefined,
      }).pipe(Effect.ignore)
    )
  )
}
