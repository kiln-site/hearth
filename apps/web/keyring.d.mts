export interface VersionedSecret {
  version: number
  value: string
}

export interface DecryptedKeyringValue {
  needsRotation: boolean
  plaintext: string
  version: number
}

export function parseSecretKeyring(
  configured: string | undefined,
  environmentName?: string
): Array<VersionedSecret>

export function encryptWithKeyring(
  plaintext: string,
  keyring: ReadonlyArray<VersionedSecret>,
  purpose: string
): string

export function decryptWithKeyring(
  encoded: string,
  keyring: ReadonlyArray<VersionedSecret>,
  purpose: string
): DecryptedKeyringValue
