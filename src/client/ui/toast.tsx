/** Transient notices. Wrap the panel in `ToastProvider` and call `useToast()`; errors stay until dismissed and are announced assertively. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from './button.tsx'
import { Icon, type IconName } from './icon.tsx'

export type ToastTone = 'info' | 'success' | 'warning' | 'danger'
export interface ToastInput { tone?: ToastTone; title: ReactNode; description?: ReactNode; action?: { label: string; onClick: () => void }
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. Defaults: 4000, danger 0. */
  duration?: number
  /** Replaces a toast with the same id instead of stacking (e.g. "Saving…" → "Saved"). */
  id?: string }
interface ToastItem extends ToastInput { id: string }
export interface ToastApi { show: (toast: ToastInput) => string; dismiss: (id: string) => void
  success: (title: ReactNode, rest?: Omit<ToastInput, 'title' | 'tone'>) => string
  error: (title: ReactNode, rest?: Omit<ToastInput, 'title' | 'tone'>) => string }

const Context = createContext<ToastApi | undefined>(undefined)
const ICONS: Record<ToastTone, IconName> = { info: 'info', success: 'decision', warning: 'alert', danger: 'alert' }

function ToastView({ toast, onDismiss, closeLabel }: { toast: ToastItem; onDismiss: () => void; closeLabel: string }) {
  const tone = toast.tone ?? 'info'
  const duration = toast.duration ?? (tone === 'danger' ? 0 : 4000)
  const [paused, setPaused] = useState(false)
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  useEffect(() => {
    if (!duration || paused) return
    const timer = setTimeout(() => dismiss.current(), duration)
    return () => clearTimeout(timer)
  }, [duration, paused, toast])
  return <div className="hx-toast" data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    <Icon name={ICONS[tone]} size={16} className="hx-toast-icon" />
    <div className="hx-toast-text"><div className="hx-toast-title">{toast.title}</div>
      {toast.description !== undefined && <div className="hx-toast-desc">{toast.description}</div>}</div>
    {toast.action && <button type="button" className="hx-toast-action" onClick={() => { toast.action!.onClick(); onDismiss() }}>
      {toast.action.label}</button>}
    <IconButton icon="close" size="sm" label={closeLabel} onClick={onDismiss} />
  </div>
}

let seq = 0
export function ToastProvider({ children, closeLabel, max = 4 }: { children: ReactNode; closeLabel: string; max?: number }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const dismiss = useCallback((id: string) => setItems(list => list.filter(item => item.id !== id)), [])
  const show = useCallback((toast: ToastInput) => {
    const id = toast.id ?? `t${++seq}`
    setItems(list => {
      const at = list.findIndex(item => item.id === id)
      if (at >= 0) return list.map((item, index) => index === at ? { ...toast, id } : item)
      return [...list, { ...toast, id }].slice(-max)
    })
    return id
  }, [max])
  const api = useMemo<ToastApi>(() => ({ show, dismiss, success: (title, rest) => show({ ...rest, title, tone: 'success' }),
    error: (title, rest) => show({ ...rest, title, tone: 'danger' }) }), [show, dismiss])
  return <Context.Provider value={api}>{children}
    {createPortal(<div className="hx-toasts" aria-live="polite">
      {items.map(item => <ToastView key={item.id} toast={item} closeLabel={closeLabel} onDismiss={() => dismiss(item.id)} />)}
    </div>, document.body)}
  </Context.Provider>
}

const noop: ToastApi = { show: () => '', dismiss: () => {}, success: () => '', error: () => '' }
/** The nearest provider's API; outside a provider calls are ignored so components stay renderable in isolation. */
export function useToast(): ToastApi { return useContext(Context) ?? noop }
