export type TimestampedBackupNamePrefix = "final" | "manual"

export function timestampedBackupName(
  prefix: TimestampedBackupNamePrefix,
  timestamp = new Date()
): string {
  const date = [
    timestamp.getUTCFullYear(),
    padTimestampPart(timestamp.getUTCMonth() + 1),
    padTimestampPart(timestamp.getUTCDate()),
  ].join(".")
  const time = [
    padTimestampPart(timestamp.getUTCHours()),
    padTimestampPart(timestamp.getUTCMinutes()),
    padTimestampPart(timestamp.getUTCSeconds()),
  ].join(".")

  return `${prefix}-${date}-${time}Z`
}

function padTimestampPart(value: number): string {
  return value.toString().padStart(2, "0")
}
