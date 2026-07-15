export const platformRoles = ["admin", "user"] as const
export type PlatformRole = (typeof platformRoles)[number]

export const accessRoles = ["owner", "admin", "operator", "viewer"] as const
export type AccessRole = (typeof accessRoles)[number]

export const accessPermissions = [
  "relay.read",
  "relay.configure",
  "relay.delete",
  "access.invite",
  "access.manage",
  "instance.read",
  "instance.console.read",
  "instance.console.write",
  "instance.files.read",
  "instance.files.write",
  "instance.power",
  "instance.settings",
  "instance.logs.share",
] as const

export type AccessPermission = (typeof accessPermissions)[number]

const rolePermissions: Record<AccessRole, ReadonlySet<AccessPermission>> = {
  owner: new Set(accessPermissions),
  admin: new Set(accessPermissions.filter((permission) => permission !== "relay.delete")),
  operator: new Set([
    "relay.read",
    "instance.read",
    "instance.console.read",
    "instance.console.write",
    "instance.files.read",
    "instance.files.write",
    "instance.power",
    "instance.logs.share",
  ]),
  viewer: new Set([
    "relay.read",
    "instance.read",
    "instance.console.read",
    "instance.files.read",
    "instance.logs.share",
  ]),
}

export const accessRoleDetails: Record<
  AccessRole,
  { description: string; label: string }
> = {
  owner: {
    label: "Owner",
    description: "Full control, including access management and Relay removal.",
  },
  admin: {
    label: "Admin",
    description: "Manage people, Relay settings, and every instance operation.",
  },
  operator: {
    label: "Operator",
    description: "Operate servers, commands, files, power, and shared logs.",
  },
  viewer: {
    label: "Viewer",
    description: "Read-only access to instance info, console, files, and logs.",
  },
}

export function roleHasPermission(
  role: AccessRole,
  permission: AccessPermission
): boolean {
  return rolePermissions[role].has(permission)
}

export function isAccessRole(value: string): value is AccessRole {
  return accessRoles.includes(value as AccessRole)
}
