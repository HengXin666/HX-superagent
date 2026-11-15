/** Layered surfaces: Modal, ConfirmDialog, right-side Drawer, anchored Popover and Tooltip. All portal to `document.body`. */
import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode, type Ref, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Button, IconButton } from './button.tsx'
import { cx, useDialogFocus, useFloating, useLatest, useOutside, type Placement } from './util.ts'

export function Modal({ open, onClose, title, description, closeLabel, footer, size = 'md', children, initialFocus, className }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; closeLabel: string; footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'; children?: ReactNode; initialFocus?: RefObject<HTMLElement | null>; className?: string
}) {
  const surface = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialogFocus(open, surface, onClose, initialFocus)
  if (!open) return null
  return createPortal(<div className="hx-layer hx-modal-layer">
    <div className="hx-mask" aria-hidden="true" onClick={onClose} />
    <div ref={surface} className={cx('hx-modal', className)} data-size={size} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="hx-modal-head"><h2 id={titleId} className="hx-modal-title">{title}</h2>
        <IconButton icon="close" label={closeLabel} size="sm" onClick={onClose} /></header>
      {description !== undefined && <div className="hx-modal-desc">{description}</div>}
      {children !== undefined && <div className="hx-modal-body">{children}</div>}
      {footer !== undefined && <footer className="hx-modal-foot">{footer}</footer>}
    </div>
  </div>, document.body)
}

/**
 * Confirmation for a consequential action. `onConfirm` may be async: the dialog stays open with a busy button
 * until it settles, closes on success, and shows the error in place on failure.
 */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, labels, danger }: {
  open: boolean; onClose: () => void; onConfirm: () => void | Promise<void>; title: string; description?: ReactNode; danger?: boolean
  labels: { confirm: string; cancel: string; close: string }
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const cancel = useRef<HTMLButtonElement>(null)
  // A second click before the first render of the busy state must not run the action twice.
  const running = useRef(false)
  useEffect(() => { if (open) { setBusy(false); setError(undefined) } }, [open])
  const run = async () => {
    if (running.current) return
    running.current = true
    setBusy(true); setError(undefined)
    try { await onConfirm(); onClose() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { running.current = false; setBusy(false) }
  }
  return <Modal open={open} onClose={() => { if (!busy) onClose() }} title={title} closeLabel={labels.close} size="sm"
    initialFocus={danger ? cancel : undefined} description={description}
    footer={<>{error && <p className="hx-modal-error" role="alert">{error}</p>}
      <Button ref={cancel} variant="ghost" onClick={onClose} disabled={busy}>{labels.cancel}</Button>
      <Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={() => { void run() }}>{labels.confirm}</Button></>} />
}

/** Right-side detail drawer for list → detail; the list stays in place behind it, and closing returns focus to the row. */
export function Drawer({ open, onClose, title, subtitle, actions, footer, closeLabel, width = 'md', children, contentKey }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; footer?: ReactNode; closeLabel: string
  width?: 'sm' | 'md' | 'lg'; children: ReactNode
  /** Changes when the drawer shows another item while staying open (a link followed inside it); focus moves back to the drawer. */
  contentKey?: string
}) {
  const surface = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialogFocus(open, surface, onClose)
  useEffect(() => {
    const active = document.activeElement
    if (open && surface.current && (!active || active === document.body || !surface.current.contains(active))) surface.current.focus()
  }, [open, contentKey])
  if (!open) return null
  return createPortal(<div className="hx-layer hx-drawer-layer">
    <div className="hx-mask hx-mask-soft" aria-hidden="true" onClick={onClose} />
    <aside ref={surface} className="hx-drawer" data-width={width} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="hx-drawer-head">
        <div className="hx-drawer-heading"><h2 id={titleId} className="hx-drawer-title">{title}</h2>
          {subtitle !== undefined && <div className="hx-drawer-sub">{subtitle}</div>}</div>
        {actions}
        <IconButton icon="close" label={closeLabel} size="sm" onClick={onClose} />
      </header>
      <div className="hx-drawer-body">{children}</div>
      {footer !== undefined && <footer className="hx-drawer-foot">{footer}</footer>}
    </aside>
  </div>, document.body)
}

export type TriggerProps = { ref: Ref<HTMLButtonElement>; onClick: () => void; 'aria-expanded': boolean; 'aria-controls'?: string; 'aria-haspopup': 'dialog' }
/** Non-modal anchored panel. Closes on outside press or Escape (focus returns to the trigger). Controlled when `open` is passed. */
export function Popover({ trigger, children, placement = 'bottom-start', label, open: controlled, onOpenChange, className }: {
  trigger: (props: TriggerProps) => ReactNode; children: ReactNode | ((close: () => void) => ReactNode); placement?: Placement; label: string
  open?: boolean; onOpenChange?: (open: boolean) => void; className?: string
}) {
  const [own, setOwn] = useState(false)
  const open = controlled ?? own
  const change = useLatest((next: boolean) => { if (controlled === undefined) setOwn(next); onOpenChange?.(next) })
  const anchor = useRef<HTMLButtonElement>(null), floating = useRef<HTMLDivElement>(null)
  const id = useId()
  useFloating(open, anchor, floating, placement)
  useOutside(open, [anchor, floating], () => change.current(false))
  useEffect(() => {
    if (!open) return
    // Escape closes the popover only, not the dialog or drawer it opened from: it listens first and stops the event there.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation(); change.current(false); anchor.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, change])
  const close = () => { change.current(false); anchor.current?.focus() }
  return <>
    {trigger({ ref: anchor, onClick: () => change.current(!open), 'aria-expanded': open, 'aria-controls': open ? id : undefined, 'aria-haspopup': 'dialog' })}
    {open && createPortal(<div ref={floating} id={id} role="dialog" aria-label={label} className={cx('hx-popover', className)}
      style={{ visibility: 'hidden' }}>{typeof children === 'function' ? children(close) : children}</div>, document.body)}
  </>
}

/** Describes its single child on hover (after `delay`) or keyboard focus; Escape hides it. The child must accept a ref and DOM handlers. */
export function Tooltip({ content, children, placement = 'top', delay = 400 }: {
  content: ReactNode; children: ReactElement; placement?: Placement; delay?: number
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLElement>(null), floating = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const id = useId()
  useFloating(open, anchor, floating, placement)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!open) return
    // Escape hides the tooltip only (APG tooltip), not the dialog or drawer around it: it listens first and stops the event there.
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); setOpen(false) } }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open])
  if (!isValidElement(children)) return children
  const props = children.props as Record<string, (event: unknown) => void>
  const chain = (name: string, fn: (event: never) => void) => (event: never) => { props[name]?.(event); fn(event) }
  const show = (now: boolean) => { clearTimeout(timer.current); if (now) setOpen(true); else timer.current = setTimeout(() => setOpen(true), delay) }
  const hide = () => { clearTimeout(timer.current); setOpen(false) }
  return <>
    {cloneElement(children as ReactElement<Record<string, unknown>>, {
      ref: anchor, 'aria-describedby': open ? id : undefined,
      onMouseEnter: chain('onMouseEnter', () => show(false)), onMouseLeave: chain('onMouseLeave', hide),
      onFocus: chain('onFocus', (event: FocusEvent) => { if ((event.target as HTMLElement).matches?.(':focus-visible')) show(true) }),
      onBlur: chain('onBlur', hide),
    })}
    {open && createPortal(<div ref={floating} id={id} role="tooltip" className="hx-tooltip" style={{ visibility: 'hidden' }}>{content}</div>,
      document.body)}
  </>
}
