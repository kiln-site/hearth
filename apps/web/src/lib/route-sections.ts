export type GlobalSection =
  | "access"
  | "bricks"
  | "security"
  | "servers"
  | "settings"
  | null

export function globalSectionFromRouteId(
  routeId: string | undefined
): GlobalSection {
  if (routeId === "/_app/bricks") return "bricks"
  if (routeId === "/_app/servers") return "servers"
  if (routeId === "/_app/access") return "access"
  if (routeId === "/_app/security") return "security"
  if (routeId?.startsWith("/_app/settings")) return "settings"
  return null
}
