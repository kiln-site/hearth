import type { RelaySnapshot } from "@workspace/contracts"

export interface RelaySnapshotSample {
  readonly sequence: number
  readonly snapshot: RelaySnapshot
}

type SnapshotListener = (sample: RelaySnapshotSample) => void

export class RelaySnapshotHub {
  readonly #intervalMs: number
  readonly #listeners = new Set<SnapshotListener>()
  readonly #load: () => Promise<RelaySnapshot>
  #closed = false
  #last: (RelaySnapshotSample & { sampledAt: number }) | null = null
  #sampling: Promise<RelaySnapshotSample> | null = null
  #sequence = 0
  #timer: ReturnType<typeof setTimeout> | null = null

  constructor(load: () => Promise<RelaySnapshot>, intervalMs = 2_000) {
    this.#intervalMs = intervalMs
    this.#load = load
  }

  read(): Promise<RelaySnapshot> {
    if (this.#last && Date.now() - this.#last.sampledAt < this.#intervalMs) {
      return Promise.resolve(this.#last.snapshot)
    }
    return this.#sample().then(({ snapshot }) => snapshot)
  }

  subscribe(listener: SnapshotListener, replay = true): () => void {
    if (this.#closed) throw new Error("Relay snapshot hub is closed")
    this.#listeners.add(listener)
    if (replay && this.#last) listener(this.#last)
    if (!this.#timer && !this.#sampling) {
      if (this.#last) this.#schedule()
      else void this.#sample().catch(() => undefined)
    }
    return () => {
      this.#listeners.delete(listener)
      if (this.#listeners.size === 0 && this.#timer) {
        clearTimeout(this.#timer)
        this.#timer = null
      }
    }
  }

  close(): void {
    this.#closed = true
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    this.#listeners.clear()
  }

  #sample(): Promise<RelaySnapshotSample> {
    if (this.#closed) {
      return Promise.reject(new Error("Relay snapshot hub is closed"))
    }
    this.#sampling ??= this.#load()
      .then((snapshot) => {
        const sample = {
          sampledAt: Date.now(),
          sequence: ++this.#sequence,
          snapshot,
        }
        this.#last = sample
        for (const listener of this.#listeners) {
          try {
            listener(sample)
          } catch {
            // One subscriber must not prevent delivery to the others.
          }
        }
        return sample
      })
      .finally(() => {
        this.#sampling = null
        if (this.#listeners.size > 0) this.#schedule()
      })
    return this.#sampling
  }

  #schedule(): void {
    if (this.#closed || this.#listeners.size === 0 || this.#timer) return
    this.#timer = setTimeout(() => {
      this.#timer = null
      void this.#sample().catch(() => undefined)
    }, this.#intervalMs)
    this.#timer.unref()
  }
}
