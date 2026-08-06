export function isManagedDatabaseNotFoundError(cause: unknown): boolean {
  return (
    cause !== null &&
    typeof cause === "object" &&
    "message" in cause &&
    cause.message === "Database not found"
  )
}
