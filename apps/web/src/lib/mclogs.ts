export const defaultMclogsApiUrl = "https://api.mclo.gs/1/log"

export function resolveMclogsApiUrl(configuredUrl: string | undefined): string {
  return configuredUrl?.trim() || defaultMclogsApiUrl
}
