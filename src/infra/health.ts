/** Component health registry displayed in the overview and source status panels. */
import type { Health } from '../sources/host.ts'

export interface HealthEntry {
  get(): Health | undefined
  set(health: Health): void
  /** Unregisters the entry from the board (such as when a Source kind unregisters); subsequent `set` calls become no-ops. */
  release(): void
}

/**
 * Central registry of component health entries, enforcing single-writer ownership per entry name.
 * Claimed by Runtime, Effects, Sessions, DshExecutor, Settings, and SourceRegistry, and read by management HTTP routes.
 */
export class HealthBoard {
  private readonly entries: Record<string, Health> = {}
  private readonly claimed = new Set<string>()
  private readonly listeners = new Set<(name: string, health: Health | undefined) => void>()
  /**
   * Calls `listener` when an entry's health really changes: its state, code, detail or values, not only its `at` stamp, and when an
   * entry is released. The panel's live feed uses it so a Source going down or a model coming back reaches every open view at once.
   */
  onChange(listener: (name: string, health: Health | undefined) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private changed(name: string, health: Health | undefined): void {
    for (const listener of this.listeners) { try { listener(name, health) } catch { /* a listener's failure is its own */ } }
  }
  claim(name: string, initial?: Health): HealthEntry {
    if (this.claimed.has(name)) throw new Error(`The health entry ${name} is reported by another part`)
    this.claimed.add(name)
    if (initial) this.entries[name] = initial
    let held = true
    return {
      get: () => this.entries[name],
      set: health => {
        if (!held) return
        const before = this.entries[name]
        this.entries[name] = health
        if (!sameHealth(before, health)) this.changed(name, health)
      },
      release: () => {
        if (!held) return
        held = false
        this.claimed.delete(name)
        const had = name in this.entries
        delete this.entries[name]
        if (had) this.changed(name, undefined)
      },
    }
  }
  get all(): Readonly<Record<string, Health>> { return this.entries }
}

/** Two readings say the same thing when all but their `at` stamp agree. */
export function sameHealth(a: Health | undefined, b: Health | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.state === b.state && a.detail === b.detail && a.code === b.code && JSON.stringify(a.values ?? {}) === JSON.stringify(b.values ?? {})
}
