import type { RelayDirectoryPage, RelayFileEntry } from "@workspace/contracts"
import { Effect, Result } from "effect"

import { ensuringPromise, promiseEffect } from "@/effect/promise"
import { getRelayDirectoryPage, searchRelayFiles } from "@/server/relay"

const emptyEntries: ReadonlyArray<RelayFileEntry> = []
const emptyDirectorySnapshot: FileDirectorySnapshot = {
  complete: false,
  entries: emptyEntries,
  error: null,
  loading: false,
}

export interface FileDirectorySnapshot {
  complete: boolean
  entries: ReadonlyArray<RelayFileEntry>
  error: Error | null
  loading: boolean
}

export interface FileIndexStatusSnapshot {
  refreshing: boolean
  searchComplete: boolean
  searching: boolean
}

export type FileIndexPathEvent =
  | { entries: ReadonlyArray<RelayFileEntry>; type: "add" }
  | { directory: string; loading: boolean; type: "directory-loading" }
  | { entries: ReadonlyArray<RelayFileEntry>; type: "reset" }

interface MutableDirectorySnapshot extends FileDirectorySnapshot {
  cursor: string | null | undefined
}

const initialStatus: FileIndexStatusSnapshot = {
  refreshing: false,
  searchComplete: true,
  searching: false,
}

export class ProgressiveFileIndex {
  readonly #instanceId: string
  readonly #relayId: string
  readonly #directories = new Map<string, MutableDirectorySnapshot>()
  readonly #directoryListeners = new Map<string, Set<() => void>>()
  readonly #knownPaths = new Set<string>()
  readonly #pathListeners = new Set<(event: FileIndexPathEvent) => void>()
  readonly #statusListeners = new Set<() => void>()
  readonly #loads = new Map<string, Promise<void>>()
  readonly #fullLoads = new Map<string, Promise<void>>()
  readonly #treeLoadingDirectories = new Map<string, number>()
  #disposed = false
  #epoch = 0
  #searchGeneration = 0
  #status = initialStatus

  constructor({
    initialRoot,
    instanceId,
    relayId,
  }: {
    initialRoot: RelayDirectoryPage | null
    instanceId: string
    relayId: string
  }) {
    this.#instanceId = instanceId
    this.#relayId = relayId
    if (initialRoot) this.#applyDirectoryPage(initialRoot)
  }

  start(): void {
    if (this.#disposed) return
    if (!this.#directories.has("")) void this.ensureDirectory("")
  }

  hydrateRoot(page: RelayDirectoryPage): void {
    if (this.#disposed || normalizeDirectoryPath(page.directory)) return
    if (this.#directories.has("")) return
    this.#applyDirectoryPage(page)
  }

  dispose(): void {
    this.#disposed = true
    this.#epoch += 1
    this.#searchGeneration += 1
    this.#directoryListeners.clear()
    this.#pathListeners.clear()
    this.#statusListeners.clear()
    this.#loads.clear()
    this.#fullLoads.clear()
    this.#treeLoadingDirectories.clear()
  }

  refresh(): void {
    if (this.#disposed) return
    const activeDirectories = [...this.#directoryListeners.keys()]
    this.#epoch += 1
    this.#searchGeneration += 1
    this.#directories.clear()
    this.#knownPaths.clear()
    this.#loads.clear()
    this.#fullLoads.clear()
    this.#treeLoadingDirectories.clear()
    this.#setStatus({ ...initialStatus, refreshing: true })
    this.#pathListeners.forEach((listener) =>
      listener({ entries: emptyEntries, type: "reset" })
    )
    this.#directoryListeners.forEach((listeners) =>
      listeners.forEach((listener) => listener())
    )
    const epoch = this.#epoch
    const reloads = [...new Set(["", ...activeDirectories])].map((directory) =>
      this.ensureDirectory(directory)
    )
    void Promise.allSettled(reloads).then(() => {
      if (!this.#disposed && epoch === this.#epoch) {
        this.#setStatus({ ...this.#status, refreshing: false })
      }
    })
  }

  getPaths(): ReadonlyArray<string> {
    return [...this.#knownPaths]
  }

  addEntry(entry: RelayFileEntry): void {
    if (!this.#disposed) this.#discover([entry])
  }

  getDirectorySnapshot(directory: string): FileDirectorySnapshot {
    return (
      this.#directories.get(normalizeDirectoryPath(directory)) ??
      emptyDirectorySnapshot
    )
  }

  getStatusSnapshot(): FileIndexStatusSnapshot {
    return this.#status
  }

  subscribeDirectory(directory: string, listener: () => void): () => void {
    const normalized = normalizeDirectoryPath(directory)
    const listeners = this.#directoryListeners.get(normalized) ?? new Set()
    listeners.add(listener)
    this.#directoryListeners.set(normalized, listeners)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.#directoryListeners.delete(normalized)
    }
  }

  subscribePaths(listener: (event: FileIndexPathEvent) => void): () => void {
    this.#pathListeners.add(listener)
    return () => this.#pathListeners.delete(listener)
  }

  subscribeStatus(listener: () => void): () => void {
    this.#statusListeners.add(listener)
    return () => this.#statusListeners.delete(listener)
  }

  ensureDirectory(directory: string): Promise<void> {
    const normalized = normalizeDirectoryPath(directory)
    const existing = this.#directories.get(normalized)
    if (existing) return Promise.resolve()
    return this.#loadNextDirectoryPage(normalized)
  }

  loadMoreDirectory(directory: string): Promise<void> {
    const normalized = normalizeDirectoryPath(directory)
    const snapshot = this.#directories.get(normalized)
    if (snapshot?.complete) return Promise.resolve()
    if (!snapshot?.entries.length)
      return this.#loadNextDirectoryPage(normalized)
    const epoch = this.#epoch
    this.#setTreeDirectoryLoading(normalized, true)
    return ensuringPromise(
      () => this.#loadNextDirectoryPage(normalized),
      () => {
        if (epoch === this.#epoch) {
          this.#setTreeDirectoryLoading(normalized, false)
        }
      }
    )
  }

  loadDirectoryFully(directory: string): Promise<void> {
    const normalized = normalizeDirectoryPath(directory)
    const active = this.#fullLoads.get(normalized)
    if (active) return active
    const epoch = this.#epoch
    const load = ensuringPromise(
      () => this.#loadDirectoryFully(normalized, epoch),
      () => {
        if (this.#fullLoads.get(normalized) === load) {
          this.#fullLoads.delete(normalized)
        }
      }
    )
    this.#fullLoads.set(normalized, load)
    return load
  }

  async #loadDirectoryFully(normalized: string, epoch: number): Promise<void> {
    await this.ensureDirectory(normalized)
    if (this.#disposed || epoch !== this.#epoch) return
    const snapshot = this.#directories.get(normalized)
    if (!snapshot?.entries.length || snapshot.complete || snapshot.error) return
    this.#setTreeDirectoryLoading(normalized, true)
    await ensuringPromise(
      () => this.#loadRemainingDirectoryPages(normalized, epoch),
      () => {
        if (epoch === this.#epoch) {
          this.#setTreeDirectoryLoading(normalized, false)
        }
      }
    )
  }

  async #loadRemainingDirectoryPages(
    directory: string,
    epoch: number
  ): Promise<void> {
    if (this.#disposed || epoch !== this.#epoch) return
    const current = this.#directories.get(directory)
    if (!current || current.complete || current.error) return
    await this.#loadNextDirectoryPage(directory)
    return this.#loadRemainingDirectoryPages(directory, epoch)
  }

  #loadNextDirectoryPage(directory: string): Promise<void> {
    const active = this.#loads.get(directory)
    if (active) return active

    const epoch = this.#epoch
    const load = ensuringPromise(
      () => this.#loadDirectoryPage(directory, epoch),
      () => {
        if (this.#loads.get(directory) === load) this.#loads.delete(directory)
      }
    )
    this.#loads.set(directory, load)
    return load
  }

  search(query: string): void {
    const normalizedQuery = query.trim()
    const generation = ++this.#searchGeneration
    if (!normalizedQuery) {
      this.#setStatus({
        ...this.#status,
        searchComplete: true,
        searching: false,
      })
      return
    }

    this.#setStatus({
      ...this.#status,
      searchComplete: false,
      searching: true,
    })
    void this.#runSearch(normalizedQuery, generation)
  }

  async #loadDirectoryPage(directory: string, epoch: number): Promise<void> {
    const previous = this.#directories.get(directory)
    this.#setDirectory(directory, {
      complete: previous?.complete ?? false,
      cursor: previous?.cursor,
      entries: previous?.entries ?? emptyEntries,
      error: null,
      loading: true,
    })

    const result = await promiseResult(() =>
      getRelayDirectoryPage({
        data: {
          ...(previous?.cursor ? { cursor: previous.cursor } : {}),
          instanceId: this.#instanceId,
          path: directory,
          relayId: this.#relayId,
        },
      })
    )
    if (this.#disposed || epoch !== this.#epoch) return
    if (Result.isSuccess(result)) {
      this.#applyDirectoryPage(result.success)
      return
    }
    const snapshot = this.#directories.get(directory)
    this.#setDirectory(directory, {
      complete: false,
      cursor: undefined,
      entries: snapshot?.entries ?? emptyEntries,
      error:
        result.failure instanceof Error
          ? result.failure
          : new Error(String(result.failure)),
      loading: false,
    })
  }

  #applyDirectoryPage(page: RelayDirectoryPage): void {
    const directory = normalizeDirectoryPath(page.directory)
    const previous = this.#directories.get(directory)
    const entries = mergeEntries(
      previous?.entries ?? emptyEntries,
      page.entries
    )
    this.#setDirectory(directory, {
      complete: page.cursor === null,
      cursor: page.cursor,
      entries,
      error: null,
      loading: false,
    })
    this.#discover(page.entries)
  }

  #discover(entries: ReadonlyArray<RelayFileEntry>): void {
    const additions: Array<RelayFileEntry> = []
    for (const entry of entries) {
      if (this.#knownPaths.has(entry.path)) continue
      this.#knownPaths.add(entry.path)
      additions.push(entry)
    }
    if (!additions.length) return
    this.#pathListeners.forEach((listener) =>
      listener({ entries: additions, type: "add" })
    )
  }

  async #runSearch(query: string, generation: number): Promise<void> {
    let cursor: string | undefined
    do {
      const result = await promiseResult(() =>
        searchRelayFiles({
          data: {
            ...(cursor ? { cursor } : {}),
            instanceId: this.#instanceId,
            query,
            relayId: this.#relayId,
          },
        })
      )
      if (this.#disposed || generation !== this.#searchGeneration) return
      if (Result.isFailure(result)) {
        this.#setStatus({
          ...this.#status,
          searchComplete: false,
          searching: false,
        })
        return
      }
      this.#discover(result.success.entries)
      cursor = result.success.cursor ?? undefined
    } while (cursor)
    this.#setStatus({
      ...this.#status,
      searchComplete: true,
      searching: false,
    })
  }

  #setDirectory(directory: string, snapshot: MutableDirectorySnapshot): void {
    this.#directories.set(directory, snapshot)
    this.#directoryListeners.get(directory)?.forEach((listener) => listener())
  }

  #setStatus(status: FileIndexStatusSnapshot): void {
    if (
      status.refreshing === this.#status.refreshing &&
      status.searchComplete === this.#status.searchComplete &&
      status.searching === this.#status.searching
    ) {
      return
    }
    this.#status = status
    this.#statusListeners.forEach((listener) => listener())
  }

  #setTreeDirectoryLoading(directory: string, loading: boolean): void {
    const current = this.#treeLoadingDirectories.get(directory) ?? 0
    const next = Math.max(0, current + (loading ? 1 : -1))
    if (next) this.#treeLoadingDirectories.set(directory, next)
    else this.#treeLoadingDirectories.delete(directory)
    if ((current === 0) === (next === 0)) return
    this.#pathListeners.forEach((listener) =>
      listener({ directory, loading: next > 0, type: "directory-loading" })
    )
  }
}

function promiseResult<TResult>(run: () => Promise<TResult>) {
  return Effect.runPromise(Effect.result(promiseEffect(run)))
}

function normalizeDirectoryPath(path: string): string {
  const normalized = path.replace(/^\/+|\/+$/gu, "")
  return normalized ? `${normalized}/` : ""
}

function mergeEntries(
  current: ReadonlyArray<RelayFileEntry>,
  incoming: ReadonlyArray<RelayFileEntry>
): ReadonlyArray<RelayFileEntry> {
  const entries = new Map(current.map((entry) => [entry.path, entry]))
  incoming.forEach((entry) => entries.set(entry.path, entry))
  return [...entries.values()].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1
    return left.path.localeCompare(right.path)
  })
}
