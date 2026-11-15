/** Static building blocks: Switch, Badge, Kbd, Card, KeyValue, Skeleton, EmptyState and the page-level SaveBar. */
import { type HTMLAttributes, type ReactNode } from 'react'
import { Button } from './button.tsx'
import { useFieldControl } from './field.tsx'
import { Icon, type IconName } from './icon.tsx'
import { cx } from './util.ts'

export function Switch({ checked, onChange, label, disabled, size = 'md', id, describedBy, className }: {
  checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean; size?: 'sm' | 'md'; id?: string; describedBy?: string
  className?: string
}) {
  const control = useFieldControl({ id, label, describedBy, disabled })
  return <button type="button" role="switch" id={control.id} aria-checked={checked} aria-label={control.ariaLabel}
    aria-describedby={control.describedBy} aria-required={control.required || undefined} aria-invalid={control.invalid || undefined}
    data-invalid={control.invalid || undefined} disabled={control.disabled || undefined} className={cx('hx-switch', className)} data-size={size} onClick={() => onChange(!checked)}><span className="hx-switch-thumb" /></button>
}

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'quiet'
export function Badge({ tone = 'neutral', dot, title, children }: { tone?: Tone; dot?: boolean; title?: string; children: ReactNode }) {
  return <span className="hx-badge" data-tone={tone} title={title}>{dot && <span className="hx-badge-dot" aria-hidden="true" />}{children}</span>
}

export type TagTone = 'outline' | 'neutral' | 'quiet' | 'success' | 'info' | 'warning' | 'danger'
/**
 * A short label on a row (a kind, a scope, a flag): a Badge whose default is an outline, so it reads as a label rather than a status.
 * `dt-tag` stays on it as the panel's hook for it.
 */
export function Tag({ tone = 'outline', title, children }: { tone?: TagTone; title?: string; children: ReactNode }) {
  return <span className="hx-badge dt-tag" data-tone={tone === 'outline' ? 'neutral' : tone} data-outline={tone === 'outline' || undefined}
    title={title}>{children}</span>
}

/** Keyboard key cap; pass `keys` for a chord such as ['⌘', 'K']. */
export function Kbd({ keys, children }: { keys?: string[]; children?: ReactNode }) {
  if (keys) return <span className="hx-kbd-chord">{keys.map((key, index) => <kbd key={index} className="hx-kbd">{key}</kbd>)}</span>
  return <kbd className="hx-kbd">{children}</kbd>
}

export function Card({ title, description, actions, footer, interactive, selected, padded = true, className, children, ...rest }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; footer?: ReactNode; interactive?: boolean; selected?: boolean; padded?: boolean
} & Omit<HTMLAttributes<HTMLElement>, 'title'>) {
  return <section className={cx('hx-card', className)} data-interactive={interactive || undefined} data-selected={selected || undefined}
    data-padded={padded || undefined} {...rest}>
    {(title !== undefined || actions !== undefined) && <header className="hx-card-head">
      <div className="hx-card-heading">{title !== undefined && <h3 className="hx-card-title">{title}</h3>}
        {description !== undefined && <p className="hx-card-desc">{description}</p>}</div>
      {actions !== undefined && <div className="hx-card-actions">{actions}</div>}
    </header>}
    {children}
    {footer !== undefined && <footer className="hx-card-foot">{footer}</footer>}
  </section>
}

export type KeyValueItem = { key: string; label: ReactNode; value: ReactNode; mono?: boolean; hint?: string }
/** Definition list; `columns` lays pairs out in a grid, empty values render as an em dash. */
export function KeyValue({ items, columns = 1, dense }: { items: KeyValueItem[]; columns?: 1 | 2 | 3; dense?: boolean }) {
  return <dl className="hx-kv" data-columns={columns} data-dense={dense || undefined}>
    {items.map(item => <div key={item.key} className="hx-kv-item">
      <dt title={item.hint}>{item.label}</dt>
      <dd data-mono={item.mono || undefined}>{item.value === undefined || item.value === null || item.value === '' ? '—' : item.value}</dd>
    </div>)}
  </dl>
}

/** The steps of the radius scale a component may ask for by name. */
const RADIUS = { xs: 'var(--hx-ui-radius-xs)', sm: 'var(--hx-ui-radius-sm)', md: 'var(--hx-ui-radius-md)', lg: 'var(--hx-ui-radius-lg)', xl: 'var(--hx-ui-radius-xl)', pill: 'var(--hx-ui-radius-pill)', round: 'var(--hx-ui-radius-round)' } as const
export type RadiusStep = keyof typeof RADIUS
/** Placeholder block shown while first data loads; `lines` renders a paragraph of bars. Hidden from assistive tech. */
export function Skeleton({ width, height = 14, radius, lines, className }: {
  /** A step of the radius scale (`--hx-ui-radius-*`); the default is the skeleton's own `--hx-skeleton-radius`. */
  width?: number | string; height?: number | string; radius?: RadiusStep; lines?: number; className?: string
}) {
  if (lines) return <span className={cx('hx-skeleton-lines', className)} aria-hidden="true">
    {Array.from({ length: lines }, (_, index) => <span key={index} className="hx-skeleton"
      style={{ height, width: index === lines - 1 && lines > 1 ? '60%' : '100%' }} />)}
  </span>
  return <span className={cx('hx-skeleton', className)} aria-hidden="true" style={{ width, height, borderRadius: radius && RADIUS[radius] }} />
}
/** Region-level loading state: announces `label` once and shows skeleton rows. */
export function LoadingBlock({ label, rows = 3 }: { label: string; rows?: number }) {
  return <div className="hx-loading" role="status" aria-live="polite"><span className="hx-sr">{label}</span>
    {Array.from({ length: rows }, (_, index) => <div key={index} className="hx-loading-row"><Skeleton width={28} height={28} radius="md" />
      <Skeleton lines={2} /></div>)}
  </div>
}

export function EmptyState({ icon = 'inbox', title, description, action, compact }: {
  icon?: IconName; title: ReactNode; description?: ReactNode; action?: ReactNode; compact?: boolean
}) {
  return <div className="hx-empty" data-compact={compact || undefined}>
    <span className="hx-empty-icon"><Icon name={icon} size={compact ? 18 : 22} /></span>
    <p className="hx-empty-title">{title}</p>
    {description !== undefined && <p className="hx-empty-desc">{description}</p>}
    {action !== undefined && <div className="hx-empty-action">{action}</div>}
  </div>
}

/**
 * Sticky bar for unsaved edits. It appears only when `dirty`, keeps the page where it is on save,
 * and binds ⌘/Ctrl+S through `useSaveShortcut` in the caller.
 */
export function SaveBar({ dirty, saving, error, onSave, onReset, labels }: {
  dirty: boolean; saving?: boolean; error?: ReactNode; onSave: () => void; onReset: () => void
  labels: { unsaved: string; save: string; reset: string }
}) {
  if (!dirty && !error) return null
  return <div className="hx-savebar" role="region" aria-label={labels.unsaved}>
    <span className="hx-savebar-text">{error ? <span className="hx-savebar-error" role="alert">{error}</span> : labels.unsaved}</span>
    <div className="hx-savebar-actions">
      <Button variant="ghost" size="sm" onClick={onReset} disabled={saving}>{labels.reset}</Button>
      <Button variant="primary" size="sm" onClick={onSave} busy={saving} disabled={!dirty}>{labels.save}</Button>
    </div>
  </div>
}
