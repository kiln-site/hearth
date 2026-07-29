import {
  DEFAULT_RELAY_NAME,
  truncateInitialRelayName,
} from "@workspace/contracts"

const defaultRelayNamePattern = /^K(\d+)$/u

export function relayNameForNewPairing(
  incomingName: string,
  existingNames: ReadonlyArray<string>
): string {
  const name = truncateInitialRelayName(incomingName)
  if (name !== DEFAULT_RELAY_NAME) return name

  let highestSequence = 99
  for (const existingName of existingNames) {
    const match = defaultRelayNamePattern.exec(existingName)
    if (!match?.[1]) continue
    const sequence = Number(match[1])
    if (Number.isSafeInteger(sequence) && sequence >= 100) {
      highestSequence = Math.max(highestSequence, sequence)
    }
  }
  return `K${highestSequence + 1}`
}
