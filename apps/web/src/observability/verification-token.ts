import { timingSafeEqual } from "node:crypto"

export function matchesVerificationToken(
  authorization: string | null,
  token: string | undefined
): boolean {
  const expected = token?.trim()
  if (!expected || !authorization?.startsWith("Bearer ")) return false
  const providedBuffer = Buffer.from(authorization.slice("Bearer ".length))
  const expectedBuffer = Buffer.from(expected)
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  )
}
