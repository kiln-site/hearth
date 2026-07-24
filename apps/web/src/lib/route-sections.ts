export type GlobalSection =
  | "access"
  | "security"
  | "servers"
  | "settings"
  | "updates"
  | null

export function globalSectionFromRouteId(
  routeId: string | undefined
): GlobalSection {
  if (routeId === "/_app/infra/servers") return "servers"
  if (routeId === "/_app/infra/updates") return "updates"
  if (routeId === "/_app/access") return "access"
  if (routeId === "/_app/security") return "security"
  if (routeId?.startsWith("/_app/settings")) return "settings"
  return null
}
