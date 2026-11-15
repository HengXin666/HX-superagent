/** Interaction hooks shared by panel views: optimistic mutations with rollback, ⌘/Ctrl+S save, and a dirty-form guard. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLatest } from './util.ts'

/**
 * Applies `next` locally at once, runs `commit`, and restores the previous value if it throws.
 * Concurrent calls are ordered: only the latest one's failure rolls back, and only to the value before it.
 */
export function useOptimistic<V>(value: V, onError?: (error: unknown) => void) {
  const [local, setLocal] = useState(value)
  const pending = useRef(0)
  useEffect(() => { if (pending.current === 0) setLocal(value) }, [value])
  const errored = useLatest(onError)
  const apply = useCallback(async (next: V, commit: () => Promise<unknown>) => {
    const ticket = ++pending.current
    let before!: V
    setLocal(current => { before = current; return next })
    try { await commit() } catch (error) {
      if (ticket === pending.current) setLocal(before)
      errored.current?.(error)
      throw error
    } finally { if (ticket === pending.current) pending.current = 0 }
  }, [errored])
  return [local, apply] as const
}

/** Runs `onSave` on ⌘S / Ctrl+S while `enabled`, without the browser's save dialog and without moving focus. */
export function useSaveShortcut(enabled: boolean, onSave: () => void) {
  const save = useLatest(onSave)
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's') { event.preventDefault(); save.current() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled, save])
}

/**
 * Local draft over a live server value: edits stay local and `dirty`; when the server value changes while clean,
 * the draft follows it (live refresh), and while dirty the draft is kept and `stale` reports the server moved on.
 */
export function useDraft<V>(server: V, equal: (a: V, b: V) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b)) {
  const [draft, setDraft] = useState(server)
  const [base, setBase] = useState(server)
  const dirty = !equal(draft, base)
  useEffect(() => {
    if (equal(server, base)) return
    if (!dirty) { setDraft(server); setBase(server) }
  }, [server]) // eslint-disable-line react-hooks/exhaustive-deps
  const stale = dirty && !equal(server, base)
  const reset = useCallback(() => { setDraft(server); setBase(server) }, [server])
  /** Marks the draft as saved (call after a successful save so the bar hides without a refetch). */
  const commit = useCallback((saved: V) => { setDraft(saved); setBase(saved) }, [])
  return { draft, setDraft, dirty, stale, reset, commit }
}
