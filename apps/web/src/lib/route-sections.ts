export type GlobalSection =
  | "access"
  | "activity"
  | "infra"
  | "security"
  | "settings"
  | null

export function globalSectionFromRouteId(
  routeId: string | undefined
): GlobalSection {
  if (routeId?.startsWith("/_app/infra")) return "infra"
  if (routeId === "/_app/activity") return "activity"
  if (routeId === "/_app/access") return "access"
  if (routeId === "/_app/security") return "security"
  if (routeId?.startsWith("/_app/settings")) return "settings"
  return null
}
