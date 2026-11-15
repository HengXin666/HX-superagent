/**
 * Actions the panel offers in more than one place, defined once so every entry (a page, a row, the overview, the command palette, the
 * console) behaves the same way. The audit's rule (X-8): an action that can be undone runs at once and offers Undo in its notice; only
 * one that cannot be undone asks first, in a confirm anchored to its button.
 */
import { useRef, useState } from 'react'
import { useAction, usePanel, usePanelData } from './provider.tsx'

/**
 * Pausing and resuming processing. It can be undone, so it never asks: the switch moves at once (`pending` until the host answers),
 * and the notice offers Undo.
 */
export function usePause() {
  const { t, call, notify } = usePanel()
  const { state, reload } = usePanelData()
  const [pending, setPending] = useState<boolean>()
  const set = async (paused: boolean, undoable: boolean) => {
    setPending(paused)
    try {
      await call('POST executor/pause', { body: { paused } })
      await reload()
    } finally { setPending(undefined) }
    notify(t(paused ? 'commandPaused' : 'commandResumed'), 'success', undoable ? { label: t('undo'),
      onClick: () => { void action.run(!paused, false) } } : undefined)
  }
  const action = useAction(set)
  const paused = pending ?? !!state?.paused
  return { paused, busy: action.busy, set: (next: boolean) => action.run(next, true), toggle: () => action.run(!paused, true) }
}

/**
 * A removal that waits a moment before it is sent, so its notice can offer Undo though the host has no way to take it back: the row
 * leaves at once (`hidden`), and the request goes out when the notice's time is up, unless Undo brought the row back.
 */
export function useDeferredRemoval(remove: (id: string) => Promise<unknown>, after: () => Promise<unknown>, message: string, delay = 5000) {
  const { t, notify } = usePanel()
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const show = (id: string) => setHidden(current => { const next = new Set(current); next.delete(id); return next })
  const start = (id: string) => {
    setHidden(current => new Set(current).add(id))
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id)
      remove(id).then(after, failure => { show(id); notify(failure instanceof Error ? failure.message : String(failure), 'danger') })
    }, delay))
    notify(message, 'success', { label: t('undo'), onClick: () => { clearTimeout(timers.current.get(id)); timers.current.delete(id); show(id) } })
  }
  return { hidden, start }
}
