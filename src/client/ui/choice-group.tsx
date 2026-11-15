/**
 * One-of-many choosers that are not dropdowns: page tabs, filter pills and a segmented radio group. All share one keyboard model:
 * arrows move and choose (radios also take ↑/↓), Home/End jump, the ends wrap, and only the chosen item is a Tab stop.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useFieldControl } from './field.tsx'
import { cx, stepIndex } from './util.ts'

/**
 * The shared roving model. Tabs move with ←/→ (horizontal tab lists); radios with ←/→ and ↑/↓ (APG radio group). Home/End jump,
 * the ends wrap, and moving also chooses (automatic activation). Focus follows the chosen item once it has rendered.
 */
function walk<V extends string>(event: KeyboardEvent, values: readonly V[], value: V, onChange: (next: V) => void, role: 'tab' | 'radio' = 'tab') {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const next = stepIndex(event.key, Math.max(0, values.indexOf(value)), values.length, undefined, role === 'tab' ? 'horizontal' : 'both')
  if (next === undefined) return
  event.preventDefault()
  const target = values[next]!
  if (target !== value) onChange(target)
  const list = event.currentTarget as HTMLElement
  const chosen = role === 'tab' ? `[role="tab"][aria-selected="true"]` : `[role="radio"][aria-checked="true"]`
  requestAnimationFrame(() => list.querySelector<HTMLElement>(chosen)?.focus())
}

/** A list's filters as pills: one is chosen at a time, so they are a tab list without panels. */
export function FilterTabs<V extends string>({ items, value, onChange, label }: {
  items: readonly { value: V; label: ReactNode }[]; value: V; onChange: (next: V) => void; label: string
}) {
  return <div role="tablist" aria-label={label} className="hx-filter-tabs"
    onKeyDown={event => walk(event, items.map(item => item.value), value, onChange)}>
    {items.map(item => <button key={item.value} type="button" role="tab" aria-selected={item.value === value}
      tabIndex={item.value === value ? 0 : -1} className="hx-pill" data-active={item.value === value || undefined}
      onClick={() => onChange(item.value)}>{item.label}</button>)}
  </div>
}

/** A toggle drawn as a pill (a filter that can be on or off on its own). */
export function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="hx-pill" data-active={active || undefined} aria-pressed={active} onClick={onClick}>{children}</button>
}

export interface PageTabItem<V extends string> { value: V; label: string; id: string; panelId: string }
/**
 * The page's top-level tab bar, drawn as the library's line tabs. Clicking the chosen tab calls `onChange` again so the page can
 * return to its root; when the tabs overflow, the clipped edge fades so the bar reads as scrollable.
 */
export function PageTabs<V extends string>({ items, value, onChange, label, className }: {
  items: readonly PageTabItem<V>[]; value: V; onChange: (next: V) => void; label: string; className?: string
}) {
  const list = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState<'start' | 'end' | 'both'>()
  const measure = useCallback(() => {
    const element = list.current
    if (!element) return
    const start = element.scrollLeft > 1, end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1
    setMore(start && end ? 'both' : start ? 'start' : end ? 'end' : undefined)
  }, [])
  // Observe the bar (pane resize) and each tab (a locale change relabels them).
  useEffect(() => {
    measure()
    if (!list.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(list.current)
    for (const tab of list.current.children) observer.observe(tab)
    return () => { observer.disconnect() }
  }, [measure, items.length])
  return <div ref={list} role="tablist" aria-label={label} className={cx('hx-tabs hx-pagetabs', className)} data-variant="line" data-more={more}
    onScroll={measure} onKeyDown={event => walk(event, items.map(item => item.value), value, onChange)}>
    {items.map(item => <button key={item.value} type="button" role="tab" id={item.id} aria-controls={item.value === value ? item.panelId : undefined}
      aria-selected={item.value === value} tabIndex={item.value === value ? 0 : -1} className="hx-tab"
      onClick={() => onChange(item.value)}>{item.label}</button>)}
  </div>
}

/** Picks one value from a few short options; it reads as a radio group rather than as tabs. */
export function SegmentedControl<V extends string>({ options, value, onChange, label, disabled, className }: {
  options: readonly { value: V; label: string; title?: string }[]; value: V; onChange: (next: V) => void; label: string; disabled?: boolean
  className?: string
}) {
  const control = useFieldControl({ label, disabled }, { labelable: false })
  return <div role="radiogroup" id={control.id} aria-label={control.ariaLabel} aria-labelledby={control.labelledBy}
    aria-describedby={control.describedBy} aria-required={control.required || undefined} aria-invalid={control.invalid || undefined}
    data-invalid={control.invalid || undefined} className={cx('hx-segmented', className)} aria-disabled={control.disabled || undefined}
    style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    onKeyDown={event => { if (!control.disabled) walk(event, options.map(option => option.value), value, onChange, 'radio') }}>
    {options.map(option => <button key={option.value} type="button" role="radio" aria-checked={option.value === value}
      tabIndex={option.value === value ? 0 : -1} title={option.title} disabled={control.disabled || undefined} className="hx-segment"
      onClick={() => { if (option.value !== value) onChange(option.value) }}>{option.label}</button>)}
  </div>
}
