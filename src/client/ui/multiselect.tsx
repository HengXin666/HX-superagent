/**
 * Ordered multiple choice. Selected values are chips in order; drag a chip, or focus it and press
 * Alt+←/→ (or Alt+↑/↓), to reorder. Delete/Backspace removes a focused chip; Backspace in the empty input removes the last.
 */
import { useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useFormField } from './field.tsx'
import { Icon } from './icon.tsx'
import { Combobox, type Option } from './select.tsx'

/** Returns a copy of `list` with the item at `from` moved to `to`. */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  if (from < 0 || from >= next.length) return next
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item!)
  return next
}

export function MultiSelect<V extends string>({ options, value, onChange, label, placeholder, disabled: off, allowCustom, sortable = true, max,
  renderChip, labels }: {
  options: Option<V>[]; value: V[]; onChange: (next: V[]) => void; label: string; placeholder?: string; disabled?: boolean
  allowCustom?: boolean; sortable?: boolean; max?: number; renderChip?: (option: Option<V> | undefined, value: V) => ReactNode
  labels: { remove: (item: string) => string; moved: (item: string, position: number, total: number) => string; empty?: string }
}) {
  // The field's input is the Combobox (it takes the field's id, label and note); the field's disabled state reaches the chips too.
  const field = useFormField()
  const disabled = !!off || (!!field && !field.group && field.disabled)
  const chips = useRef<HTMLUListElement>(null)
  const [drag, setDrag] = useState<number>()
  const [over, setOver] = useState<number>()
  const [announce, setAnnounce] = useState('')
  const find = (v: V) => options.find(option => option.value === v)
  const name = (v: V) => find(v)?.label ?? v
  const focusChip = (index: number) => requestAnimationFrame(() =>
    chips.current?.querySelectorAll<HTMLElement>('.hx-chip')[index]?.focus())
  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length || from === to) return
    onChange(reorder(value, from, to))
    setAnnounce(labels.moved(name(value[from]!), to + 1, value.length))
    focusChip(to)
  }
  const root = useRef<HTMLDivElement>(null)
  /** Focus stays on the chip that took the removed one's place, or moves to the input once no chip is left. */
  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
    if (value.length > 1) focusChip(Math.min(index, value.length - 2))
    else requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('input')?.focus())
  }
  const onChipKey = (event: KeyboardEvent, index: number) => {
    if (disabled) return
    if (sortable && event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowUp')) { event.preventDefault(); move(index, index - 1) }
    else if (sortable && event.altKey && (event.key === 'ArrowRight' || event.key === 'ArrowDown')) { event.preventDefault(); move(index, index + 1) }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(index) }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); focusChip(Math.max(0, index - 1)) }
    else if (event.key === 'ArrowRight') { event.preventDefault(); focusChip(Math.min(value.length - 1, index + 1)) }
  }
  const onDrop = (event: DragEvent, index: number) => {
    event.preventDefault()
    if (drag !== undefined) move(drag, index)
    setDrag(undefined); setOver(undefined)
  }
  const full = max !== undefined && value.length >= max
  return <div ref={root} className="hx-multi" data-disabled={disabled || undefined}>
    {value.length > 0 && <ul ref={chips} className="hx-chips" aria-label={label}>
      {value.map((v, index) => <li key={v} className="hx-chip" tabIndex={disabled ? -1 : 0} draggable={sortable && !disabled}
        aria-roledescription={sortable ? 'sortable item' : undefined} data-dragging={drag === index || undefined}
        data-over={over === index && drag !== index || undefined} onKeyDown={event => onChipKey(event, index)}
        onDragStart={event => { setDrag(index); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', v) }}
        onDragOver={event => { if (drag !== undefined) { event.preventDefault(); setOver(index) } }}
        onDragLeave={() => setOver(current => current === index ? undefined : current)}
        onDrop={event => onDrop(event, index)} onDragEnd={() => { setDrag(undefined); setOver(undefined) }}>
        {sortable && <span className="hx-chip-grip" aria-hidden="true"><Icon name="grip" size={12} /></span>}
        {sortable && <span className="hx-chip-index" aria-hidden="true">{index + 1}</span>}
        <span className="hx-chip-label">{renderChip ? renderChip(find(v), v) : name(v)}</span>
        {!disabled && <button type="button" className="hx-chip-remove" tabIndex={-1} aria-label={labels.remove(name(v))}
          onClick={() => remove(index)}><Icon name="close" size={12} /></button>}
      </li>)}
    </ul>}
    {!full && <Combobox<V> options={options.filter(option => !value.includes(option.value))} value={null} label={label}
      placeholder={placeholder} disabled={disabled} allowCustom={allowCustom} clearOnSelect empty={labels.empty}
      onChange={next => { if (!value.includes(next)) onChange([...value, next]) }}
      onBackspaceEmpty={() => { if (value.length) focusChip(value.length - 1) }} />}
    <span className="hx-sr" aria-live="polite">{announce}</span>
  </div>
}
