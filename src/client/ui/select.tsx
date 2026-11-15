/**
 * Choosing from a list. `Select` is a button that opens a listbox (type-ahead, arrows, Enter/Space);
 * `Combobox` is a filterable text input with the ARIA 1.2 combobox pattern and optional free text.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useFieldControl } from './field.tsx'
import { Icon } from './icon.tsx'
import { cx, stepIndex, useFloating, useOutside } from './util.ts'

export interface Option<V extends string = string> { value: V; label: string; description?: string; group?: string; disabled?: boolean; meta?: ReactNode }

/** Case-insensitive match on label, value and description, every whitespace-separated term must match. */
export function matchOption(option: Option, query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const hay = `${option.label} ${option.value} ${option.description ?? ''}`.toLowerCase()
  return terms.every(term => hay.includes(term))
}

function Listbox<V extends string>({ id, options, active, selected, onPick, onHover, floating, empty, label }: {
  id: string; options: Option<V>[]; active: number; selected: (value: V) => boolean; onPick: (option: Option<V>) => void
  onHover: (index: number) => void; floating: RefObject<HTMLDivElement>; empty: string; label: string
}) {
  useEffect(() => {
    floating.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active, floating])
  let group: string | undefined
  return createPortal(<div ref={floating} className="hx-listbox-pop" style={{ visibility: 'hidden' }}>
    <ul id={id} role="listbox" aria-label={label} className="hx-listbox">
      {options.length === 0 && <li className="hx-listbox-empty" role="presentation">{empty}</li>}
      {options.map((option, index) => {
        const header = option.group !== undefined && option.group !== group ? option.group : undefined
        group = option.group
        return [header !== undefined && <li key={`g-${header}`} role="presentation" className="hx-listbox-group">{header}</li>,
          <li key={option.value} id={`${id}-${index}`} data-index={index} data-value={option.value} role="option" aria-selected={selected(option.value)}
            aria-disabled={option.disabled || undefined} className="hx-option" data-active={index === active || undefined}
            onMouseDown={event => event.preventDefault()} onMouseMove={() => onHover(index)}
            onClick={() => { if (!option.disabled) onPick(option) }}>
            <span className="hx-option-text"><span className="hx-option-label">{option.label}</span>
              {option.description && <span className="hx-option-desc">{option.description}</span>}</span>
            {option.meta}
            {selected(option.value) && <Icon name="check" size={14} className="hx-option-check" />}
          </li>]
      })}
    </ul>
  </div>, document.body)
}

export function Select<V extends string>({ options, value, onChange, label, placeholder, disabled: off, size = 'md', id: own, empty = '—', className,
  invalid }: {
  options: Option<V>[]; value: V | undefined; onChange: (next: V) => void; label: string; placeholder?: string; disabled?: boolean
  size?: 'sm' | 'md'; id?: string; empty?: string; className?: string; invalid?: boolean
}) {
  const control = useFieldControl({ id: own, label, disabled: off, invalid })
  const { id, disabled } = control
  const auto = useId(), listId = `${id ?? auto}-list`
  const button = useRef<HTMLButtonElement>(null), floating = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const current = options.findIndex(option => option.value === value)
  const [active, setActive] = useState(current)
  const typed = useRef({ text: '', at: 0 })
  useFloating(open, button, floating, 'bottom-start', true)
  useOutside(open, [button, floating], () => setOpen(false))
  const show = () => { setActive(current >= 0 ? current : stepIndex('Home', 0, options.length, i => !!options[i]!.disabled) ?? 0); setOpen(true) }
  const pick = (option: Option<V>) => { setOpen(false); if (option.value !== value) onChange(option.value); button.current?.focus() }
  const onKeyDown = (event: KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show() }
      return
    }
    const next = stepIndex(event.key, active, options.length, i => !!options[i]!.disabled)
    if (next !== undefined) { event.preventDefault(); setActive(next); return }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); const option = options[active]; if (option && !option.disabled) pick(option) }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false) }
    else if (event.key === 'Tab') setOpen(false)
    else if (event.key.length === 1) {
      const now = Date.now()
      typed.current = { text: (now - typed.current.at > 600 ? '' : typed.current.text) + event.key.toLowerCase(), at: now }
      const found = options.findIndex(option => !option.disabled && option.label.toLowerCase().startsWith(typed.current.text))
      if (found >= 0) setActive(found)
    }
  }
  const chosen = options[current]
  return <>
    <button ref={button} type="button" id={id} role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined} aria-label={control.ariaLabel}
      aria-describedby={control.describedBy} aria-invalid={control.invalid || undefined} aria-required={control.required || undefined}
      disabled={disabled || undefined} className={cx('hx-select', className)} data-invalid={control.invalid || undefined} data-size={size} data-value={value} data-placeholder={!chosen || undefined}
      onClick={() => open ? setOpen(false) : show()} onKeyDown={onKeyDown}>
      <span className="hx-select-value">{chosen?.label ?? placeholder ?? ''}</span>
      <Icon name="chevron-down" size={14} className="hx-select-chevron" />
    </button>
    {open && <Listbox id={listId} label={label} options={options} active={active} selected={v => v === value} onPick={pick} onHover={setActive}
      floating={floating} empty={empty} />}
  </>
}

export type ComboboxProps<V extends string> = {
  options: Option<V>[]; value: V | null; onChange: (next: V) => void; label: string; placeholder?: string; disabled?: boolean
  size?: 'sm' | 'md'; id?: string; empty?: string; invalid?: boolean
  /** Accept typed text that matches no option; `onChange` receives the trimmed text. */
  allowCustom?: boolean
  /** Empty the input after a pick (used by MultiSelect to add several values in a row). */
  clearOnSelect?: boolean
  /** Extra values to mark as selected in the list (MultiSelect passes its values). */
  isSelected?: (value: V) => boolean
  filter?: (option: Option<V>, query: string) => boolean
  onBackspaceEmpty?: () => void
}
export function Combobox<V extends string>({ options, value, onChange, label, placeholder, disabled: off, size = 'md', id: own, empty = '—',
  invalid: bad, allowCustom, clearOnSelect, isSelected, filter = matchOption, onBackspaceEmpty }: ComboboxProps<V>) {
  const control = useFieldControl({ id: own, label, disabled: off, invalid: bad })
  const { id, disabled, invalid } = control
  const auto = useId(), listId = `${id ?? auto}-list`
  const input = useRef<HTMLInputElement>(null), wrap = useRef<HTMLSpanElement>(null), floating = useRef<HTMLDivElement>(null)
  const labelOf = (v: V | null) => v === null ? '' : options.find(option => option.value === v)?.label ?? v
  const [text, setText] = useState(clearOnSelect ? '' : labelOf(value))
  const [query, setQuery] = useState<string>()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  useEffect(() => { if (!clearOnSelect && query === undefined) setText(labelOf(value)) }, [value, options]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => query ? options.filter(option => filter(option, query)) : options, [options, query, filter])
  useFloating(open, wrap, floating, 'bottom-start', true)
  const revert = () => { setQuery(undefined); setText(clearOnSelect ? '' : labelOf(value)) }
  const close = () => { setOpen(false); setActive(-1) }
  useOutside(open, [wrap, floating], () => { close(); commitOrRevert() })
  const pick = (option: Option<V>) => {
    setQuery(undefined); setText(clearOnSelect ? '' : option.label); close()
    if (option.value !== value || clearOnSelect) onChange(option.value)
  }
  const commitOrRevert = () => {
    const typedText = (query ?? '').trim()
    const exact = options.find(option => option.label.toLowerCase() === typedText.toLowerCase() || option.value === typedText)
    if (query !== undefined && exact && !exact.disabled) pick(exact)
    else if (query !== undefined && allowCustom && typedText) { setQuery(undefined); if (clearOnSelect) setText(''); onChange(typedText as V) }
    else revert()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) { setOpen(true); setActive(event.key === 'ArrowDown' ? 0 : shown.length - 1); return }
      const next = stepIndex(event.key, active, shown.length, i => !!shown[i]!.disabled)
      if (next !== undefined) setActive(next)
    } else if (event.key === 'Enter') {
      if (open && active >= 0 && shown[active]) { event.preventDefault(); pick(shown[active]!) }
      else if (query !== undefined) { event.preventDefault(); close(); commitOrRevert() }
    } else if (event.key === 'Escape') {
      if (open || query !== undefined) { event.preventDefault(); event.stopPropagation() }
      close(); revert()
    } else if (event.key === 'Tab') { close(); commitOrRevert() }
    else if (event.key === 'Backspace' && text === '') onBackspaceEmpty?.()
  }
  return <>
    <span ref={wrap} className="hx-input hx-combobox" data-size={size} data-invalid={invalid || undefined} data-disabled={disabled || undefined}>
      <input ref={input} id={id} role="combobox" aria-label={control.ariaLabel} aria-describedby={control.describedBy}
        aria-required={control.required || undefined} aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-autocomplete="list" aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined} aria-invalid={invalid || undefined}
        autoComplete="off" spellCheck={false} disabled={disabled} placeholder={placeholder} value={text}
        onChange={event => { setText(event.target.value); setQuery(event.target.value); setOpen(true); setActive(event.target.value ? 0 : -1) }}
        onClick={() => setOpen(true)} onKeyDown={onKeyDown} />
      <button type="button" tabIndex={-1} className="hx-combobox-toggle" aria-hidden="true" disabled={disabled}
        onMouseDown={event => event.preventDefault()} onClick={() => { input.current?.focus(); setOpen(!open) }}>
        <Icon name="chevron-down" size={14} /></button>
    </span>
    {open && <Listbox id={listId} label={label} options={shown} active={active} floating={floating} empty={empty} onHover={setActive}
      onPick={pick} selected={v => isSelected ? isSelected(v) : v === value} />}
  </>
}
