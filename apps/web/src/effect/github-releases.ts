import { Effect, Schema } from "effect"

import { ExternalServiceError } from "@/effect/errors"

const repositoryApi = "https://api.github.com/repos/kiln-site/hearth/releases"
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "kiln-hearth",
  "X-GitHub-Api-Version": "2022-11-28",
}

const GitHubAssetSchema = Schema.Struct({
  browser_download_url: Schema.String,
  name: Schema.String,
})

const GitHubReleaseSchema = Schema.Struct({
  assets: Schema.Array(GitHubAssetSchema),
  body: Schema.NullOr(Schema.String),
  draft: Schema.Boolean,
  html_url: Schema.String,
  name: Schema.NullOr(Schema.String),
  prerelease: Schema.Boolean,
  published_at: Schema.NullOr(Schema.String),
  tag_name: Schema.String,
})

const ReleaseComponentSchema = Schema.Struct({
  digest: Schema.String,
  image: Schema.String,
})

export const ReleaseManifestSchema = Schema.Struct({
  channel: Schema.Literals(["nightly", "stable"]),
  commit: Schema.String,
  compatibility: Schema.Struct({
    relayProtocol: Schema.Number,
  }),
  components: Schema.Struct({
    hearth: ReleaseComponentSchema,
    relay: ReleaseComponentSchema,
  }),
  publishedAt: Schema.String,
  schemaVersion: Schema.Literal(1),
  version: Schema.String,
})

export type KilnReleaseManifest = typeof ReleaseManifestSchema.Type
export type PublicKilnRelease = {
  channel: "nightly" | "stable"
  manifestUrl: string
  name: string
  notes: string | null
  publishedAt: string | null
  tag: string
  url: string
  version: string
}

export const listKilnReleasesEffect = Effect.fn("github.releases.list")(
  function* () {
    const releases = yield* requestJson(
      `${repositoryApi}?per_page=100`,
      Schema.Array(GitHubReleaseSchema)
    )
    return releases.flatMap((release): Array<PublicKilnRelease> => {
      if (release.draft || !release.tag_name.startsWith("v")) return []
      const version = release.tag_name.slice(1)
      if (!/^0\.\d+\.\d+(?:-nightly\.\d+)?$/u.test(version)) return []
      const manifest = release.assets.find(
        (asset) => asset.name === "release-manifest.json"
      )
      if (!manifest) return []
      return [
        {
          channel: release.prerelease ? "nightly" : "stable",
          manifestUrl: manifest.browser_download_url,
          name: release.name?.trim() || release.tag_name,
          notes: release.body?.trim() || null,
          publishedAt: release.published_at,
          tag: release.tag_name,
          url: release.html_url,
          version,
        },
      ]
    })
  }
)

export const kilnReleaseManifestEffect = Effect.fn("github.releases.manifest")(
  function* (tag: string) {
    const release = yield* requestJson(
      `${repositoryApi}/tags/${encodeURIComponent(tag)}`,
      GitHubReleaseSchema
    )
    if (release.draft) {
      return yield* ExternalServiceError.make({
        message: "The selected Kiln release is still a draft",
        service: "GitHub Releases",
      })
    }
    const manifest = release.assets.find(
      (asset) => asset.name === "release-manifest.json"
    )
    if (!manifest) {
      return yield* ExternalServiceError.make({
        message: "The selected Kiln release has no update manifest",
        service: "GitHub Releases",
      })
    }
    return yield* requestJson(
      manifest.browser_download_url,
      ReleaseManifestSchema
    )
  }
)

function requestJson<TValue>(
  url: string,
  schema: Schema.Decoder<TValue>
): Effect.Effect<TValue, ExternalServiceError> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        throw new Error(`GitHub returned HTTP ${response.status}`)
      }
      return Schema.decodeUnknownSync(schema)(await response.json())
    },
    catch: (cause) =>
      ExternalServiceError.make({
        cause,
        message:
          cause instanceof Error
            ? cause.message
            : "GitHub returned an invalid response",
        service: "GitHub Releases",
      }),
  })
}
