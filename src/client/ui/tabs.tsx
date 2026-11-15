/** Tabs with roving focus (←/→/Home/End), automatic activation, optional counts; `TabPanel` wires the matching ids. */
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx, stepIndex } from './util.ts'

export interface TabItem<V extends string> { value: V; label: ReactNode; count?: number; disabled?: boolean }
const tabId = (base: string, value: string) => `${base}-tab-${value}`
const panelId = (base: string, value: string) => `${base}-panel-${value}`

export function Tabs<V extends string>({ items, value, onChange, label, idBase, variant = 'line', size = 'md', className }: {
  items: readonly TabItem<V>[]; value: V; onChange: (next: V) => void; label: string; idBase: string
  variant?: 'line' | 'segmented'; size?: 'sm' | 'md'; className?: string
}) {
  const list = useRef<HTMLDivElement>(null)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const index = items.findIndex(item => item.value === value)
    const next = stepIndex(event.key, Math.max(0, index), items.length, i => !!items[i]!.disabled, 'horizontal')
    if (next === undefined) return
    event.preventDefault()
    const target = items[next]!
    if (target.value !== value) onChange(target.value)
    document.getElementById(tabId(idBase, target.value))?.focus()
  }
  return <div ref={list} role="tablist" aria-label={label} className={cx('hx-tabs', className)} data-variant={variant} data-size={size}
    onKeyDown={onKeyDown}>
    {items.map(item => <button key={item.value} type="button" role="tab" id={tabId(idBase, item.value)}
      aria-controls={item.value === value ? panelId(idBase, item.value) : undefined} aria-selected={item.value === value} tabIndex={item.value === value ? 0 : -1}
      disabled={item.disabled} className="hx-tab" onClick={() => onChange(item.value)}>
      <span>{item.label}</span>{item.count !== undefined && <span className="hx-tab-count">{item.count}</span>}
    </button>)}
  </div>
}

export function TabPanel({ idBase, value, active, children, className }: {
  idBase: string; value: string; active: boolean; children: ReactNode; className?: string
}) {
  if (!active) return null
  return <div role="tabpanel" id={panelId(idBase, value)} aria-labelledby={tabId(idBase, value)} tabIndex={0} className={cx('hx-tabpanel', className)}>
    {children}
  </div>
}
