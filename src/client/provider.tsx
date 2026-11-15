/** Shared panel React contexts, state polling, restart detection, and action runner hook. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { caller, usePoll, type ApiMessages, type Call, type SetupView, type StateView } from './api.ts'
import { holdLive, LiveContext, type LiveClient, type LiveEvent } from './live.ts'
import type { Route } from './route.ts'
import STYLES from './client.css?raw'
import { ToastProvider, UI_STYLES, useToast, type ToastApi, type ToastTone } from './ui/index.ts'
import { errorText, setupText, valueLabel, type T } from './text.ts'

export interface PanelContext {
  t: T
  call: Call
  navigate: (route: Route, replace?: boolean) => void
  back: () => void
  backLabel: string
  openSession: (sessionId: string) => Promise<void>
  /**
   * Shows a notice; `danger` notices stay until dismissed and are announced at once. `action` adds a button to it, such as Undo after
   * an action that can be reversed, or Retry after one that failed.
   */
  notify: (text: string, tone?: ToastTone, action?: { label: string; onClick: () => void }) => void
  restart: () => void
}
export interface PanelData {
  state: StateView | undefined
  error: Error | undefined
  reload: () => Promise<void>
  setup: SetupView | undefined
  /** Executor Sessions in an active turn, which a restart of `dsh-superagent` interrupts. */
  running: number
  /** Incremented each time dsh-superagent recovers from a restart so dependent views refetch. */
  restarts: number
  /** When the host last confirmed the panel's state (ms since the epoch), so the header can say how current the page is. */
  updatedAt: number | undefined
  /** Change the panel's state on screen at once while `action` runs; it goes back if `action` fails (see `usePoll`'s `mutate`). */
  mutate: <R>(patch: (state: StateView) => StateView, action: () => Promise<R>) => Promise<R>
}
const Panel = createContext<PanelContext | undefined>(undefined)
const PanelState = createContext<PanelData | undefined>(undefined)
export function usePanel(): PanelContext {
  const value = useContext(Panel)
  if (!value) throw new Error('dsh-superagent page rendered outside its panel')
  return value
}
export function usePanelData(): PanelData {
  const value = useContext(PanelState)
  if (!value) throw new Error('dsh-superagent page rendered outside its panel')
  return value
}
/** Wrap an async action with re-entrancy protection, busy state, optional reload, and error toast reporting. */
export function useAction<A extends unknown[]>(action: (...args: A) => Promise<unknown>,
  { reload }: { reload?: () => Promise<unknown> } = {}) {
  const { notify } = usePanel()
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const run = async (...args: A): Promise<boolean> => {
    if (running.current) return false
    running.current = true
    setBusy(true)
    try { await action(...args); await reload?.(); return true }
    catch (failure) { notify(errorText(failure), 'danger'); return false }
    finally { running.current = false; setBusy(false) }
  }
  return { run, busy }
}

/** Which live events change the panel's state: every Store write and health change, and only the Assignment steps of `stage`. */
export const assignmentStep = (event: LiveEvent): boolean => event.topic !== 'stage'
  || /^assignment\.|^ticket\.(created|ended|resumed)$/.test((event.data as { type?: string } | undefined)?.type ?? '')
const messages = (t: T): ApiMessages => ({
  offline: t('offline'), notRunning: t('hostNotRunning'), serverError: status => t('serverError', { status }),
    requestFailed: status => t('requestFailed', { status }),
  setup: problem => problem.values.output ? `${setupText(t, problem)}\n${problem.values.output}` : setupText(t, problem),
  // A refusal names a prompt part by its label.
  user: ({ code, values }) => t(`userError.${code}`, values.part ? { ...values, part: valueLabel(t, 'promptPart', values.part) } : values),
})
/** Hands the toast API of the library's provider to the panel's `notify`, which lives above it. */
function ToastBridge({ target }: { target: { current: ToastApi | undefined } }) {
  target.current = useToast()
  return null
}
const stay = () => {}
const noSession = async () => {}
export function PanelProvider({ t, interval = 5000, openSession = noSession, navigate = stay, back = stay, backLabel = '', live: liveUrl, children }: {
  t: T; interval?: number; openSession?: (sessionId: string) => Promise<void>; navigate?: PanelContext['navigate']; back?: () => void
  backLabel?: string
  /** The live feed's address; the panel streams it unless it is `null`. */
  live?: string | null
  children: ReactNode
}) {
  // The page's one connection to the feed, shared with any other provider on it.
  const [live, setLive] = useState<LiveClient | null>(null)
  useEffect(() => {
    if (liveUrl === null) return
    const held = holdLive(liveUrl)
    setLive(held.client)
    return () => { held.release(); setLive(null) }
  }, [liveUrl])
  // Read the current translator via ref so locale changes do not recreate `call` and restart polling.
  const copy = useRef(t)
  copy.current = t
  const call = useMemo(() => caller(() => messages(copy.current)), [])
  const toasts = useRef<ToastApi | undefined>(undefined)
  // The same text replaces its notice rather than stacking it.
  const notify = useCallback((text: string, tone: ToastTone = 'info', action?: { label: string; onClick: () => void }) => {
    toasts.current?.show({ id: text, title: text, tone, ...action ? { action } : {} })
  }, [])
  // Poll at 1s during a restart until the server goes down and answers again, or time out after 30s if the restart completed between polls.
  const [restarting, setRestarting] = useState<{ down: boolean }>()
  const [restarts, setRestarts] = useState(0)
  const restart = useCallback(() => setRestarting({ down: false }), [])
  // The header's load and executor slots change when an Assignment starts or ends, which the `stage` topic says even before the
  // Ticket's own write lands; every other step is left to the views that show it.
  const { data: state, error, reload, mutate, updatedAt } = usePoll(() => call('GET state'), [call], restarting ? 1000 : interval,
    restarting ? { client: null } : { live: ['ticket', 'settings', 'health', 'stage'], client: live, filter: assignmentStep })
  if (restarting && !!error !== restarting.down) {
    setRestarting(error ? { down: true } : undefined)
    if (!error) setRestarts(restarts + 1)
  }
  useEffect(() => {
    if (!restarting) return
    const timer = setTimeout(() => setRestarting(undefined), 30_000)
    return () => clearTimeout(timer)
  }, [restarting])
  const context = useMemo(() => ({ t, call, navigate, back, backLabel, openSession, notify, restart }), [t, call, navigate, back, backLabel,
    openSession, notify, restart])
  const data = useMemo(() => ({ state, error, reload, setup: state?.setup, running: state?.load.running ?? 0, restarts, updatedAt, mutate }),
    [state, error, reload, restarts, updatedAt, mutate])
  return <Panel.Provider value={context}><PanelState.Provider value={data}><LiveContext.Provider value={live}>
    <style>{UI_STYLES}</style>
    <style>{STYLES}</style>
    <ToastProvider closeLabel={t('close')}><ToastBridge target={toasts} />{children}</ToastProvider>
  </LiveContext.Provider></PanelState.Provider></Panel.Provider>
}
