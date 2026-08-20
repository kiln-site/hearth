export const platformRoles = ["admin", "relay_creator", "user"] as const
export type PlatformRole = (typeof platformRoles)[number]

export const platformPermissions = [
  "platform.appearance.manage-default",
  "platform.backups.manage-storage",
  "platform.backups.manage-limits",
  "platform.network.override-public-port-range",
] as const
export type PlatformPermission = (typeof platformPermissions)[number]

const platformRolePermissions: Record<
  PlatformRole,
  ReadonlySet<PlatformPermission>
> = {
  admin: new Set(platformPermissions),
  relay_creator: new Set(),
  user: new Set(),
}

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
  "instance.delete",
  "instance.power",
  "instance.settings",
  "instance.logs.share",
  "instance.network.read",
  "instance.network.write",
  "instance.network.public-port.write",
  "instance.sftp.connect",
  "database.read",
  "database.create",
  "database.credentials.read",
  "database.credentials.rotate",
  "database.power",
  "database.delete",
  "database.network.read",
  "database.network.write",
  "database.dump.export",
  "database.dump.import",
  "backup.read",
  "backup.create",
  "backup.download",
  "backup.restore",
  "backup.delete",
] as const

export type AccessPermission = (typeof accessPermissions)[number]

export function instancePortsWritePermission(
  ports: ReadonlyArray<{ externalPort?: number; id?: string }>
): AccessPermission {
  return ports.some(
    (port) => port.id !== undefined && port.externalPort !== undefined
  )
    ? "instance.network.public-port.write"
    : "instance.network.write"
}

const rolePermissions: Record<AccessRole, ReadonlySet<AccessPermission>> = {
  owner: new Set(accessPermissions),
  admin: new Set(
    accessPermissions.filter((permission) => permission !== "relay.delete")
  ),
  operator: new Set([
    "relay.read",
    "instance.read",
    "instance.console.read",
    "instance.console.write",
    "instance.files.read",
    "instance.files.write",
    "instance.power",
    "instance.logs.share",
    "instance.network.read",
    "instance.network.write",
    "instance.sftp.connect",
    "database.read",
    "database.credentials.read",
    "database.power",
    "database.network.read",
    "database.network.write",
    "database.dump.export",
    "database.dump.import",
    "backup.read",
    "backup.create",
    "backup.download",
    "backup.restore",
    "backup.delete",
  ]),
  viewer: new Set([
    "relay.read",
    "instance.read",
    "instance.console.read",
    "instance.files.read",
    "instance.logs.share",
    "instance.network.read",
    "instance.sftp.connect",
    "database.read",
    "database.network.read",
    "backup.read",
    "backup.download",
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
    description:
      "Operate servers and databases, including power, files, and private networks.",
  },
  viewer: {
    label: "Viewer",
    description:
      "Read-only access to assigned servers, databases, consoles, files, and logs.",
  },
}

export function roleHasPermission(
  role: AccessRole,
  permission: AccessPermission
): boolean {
  return rolePermissions[role].has(permission)
}

export function platformRoleHasPermission(
  role: PlatformRole,
  permission: PlatformPermission
): boolean {
  return platformRolePermissions[role].has(permission)
}

export function isAccessRole(value: string): value is AccessRole {
  return accessRoles.includes(value as AccessRole)
}
