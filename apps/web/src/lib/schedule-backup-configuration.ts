export function scheduleBackupDestination(
  destinationKey: string | undefined
): { kind: "local" } | { kind: "storage"; storageId: string } {
  if (
    destinationKey === undefined ||
    destinationKey === "default" ||
    destinationKey === "local"
  ) {
    return { kind: "local" }
  }
  return { kind: "storage", storageId: destinationKey }
}
