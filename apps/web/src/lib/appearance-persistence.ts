export function enqueueAppearancePersistence(
  pending: Promise<void>,
  persist: () => Promise<unknown>
): Promise<void> {
  return pending.then(persist, persist).then(
    () => undefined,
    () => undefined
  )
}
