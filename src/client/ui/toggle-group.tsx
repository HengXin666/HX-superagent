/**
 * Choices drawn as a row of toggle buttons whose look the page gives (`itemClassName`): `RadioGroup` picks one (APG radio group:
 * arrows move and choose, Home/End, the ends wrap, disabled items are skipped, only the chosen item is a Tab stop) and
 * `CheckboxGroup` picks any (each item a Tab stop, Space/Enter toggles). Both wire into the field around them through
 * `useFieldControl`: named by its label (`aria-labelledby`), described by its note and error, and marked invalid (and, for the radio
 * group, required) with the field.
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useFieldControl } from './field.tsx'
import { cx, stepIndex } from './util.ts'

export interface ToggleOption<V extends string> { value: V; label: ReactNode; title?: string | undefined; disabled?: boolean | undefined
  className?: string | undefined
  /** `data-*` attributes the page styles the item by (`{ 'data-deny': '' }`). */
  data?: Record<`data-${string}`, string | undefined> | undefined }

export function RadioGroup<V extends string>({ options, value, onChange, label, disabled, className, itemClassName }: {
  options: readonly ToggleOption<V>[]; value: V | undefined; onChange: (next: V) => void; label: string; disabled?: boolean
  className?: string; itemClassName?: string
}) {
  const control = useFieldControl({ label, disabled }, { labelable: false })
  const root = useRef<HTMLDivElement>(null)
  const off = (index: number) => control.disabled || !!options[index]?.disabled
  const chosen = options.findIndex(option => option.value === value)
  // The Tab stop: the chosen item, or the first one that can be chosen while none is.
  const stop = chosen >= 0 && !off(chosen) ? chosen : options.findIndex((_, index) => !off(index))
  const onKeyDown = (event: KeyboardEvent) => {
    if (control.disabled || event.altKey || event.ctrlKey || event.metaKey) return
    const next = stepIndex(event.key, Math.max(0, chosen), options.length, off, 'both')
    if (next === undefined) return
    event.preventDefault()
    const target = options[next]!
    if (target.value !== value) onChange(target.value)
    root.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
  }
  return <div ref={root} role="radiogroup" id={control.id} aria-label={control.ariaLabel} aria-labelledby={control.labelledBy}
    aria-describedby={control.describedBy} aria-required={control.required || undefined} aria-invalid={control.invalid || undefined}
    aria-disabled={control.disabled || undefined} data-invalid={control.invalid || undefined} className={className} onKeyDown={onKeyDown}>
    {options.map((option, index) => <button key={option.value} type="button" role="radio" aria-checked={option.value === value}
      tabIndex={index === stop ? 0 : -1} title={option.title} disabled={off(index) || undefined} className={cx(itemClassName, option.className)}
      {...option.data} onClick={() => { if (option.value !== value) onChange(option.value) }}>{option.label}</button>)}
  </div>
}

export function CheckboxGroup<V extends string>({ options, value, onChange, label, disabled, className, itemClassName }: {
  options: readonly ToggleOption<V>[]; value: readonly V[]; onChange: (next: V[]) => void; label: string; disabled?: boolean
  className?: string; itemClassName?: string
}) {
  const control = useFieldControl({ label, disabled }, { labelable: false })
  const toggle = (item: V) => onChange(value.includes(item) ? value.filter(other => other !== item) : [...value, item])
  // A group takes no aria-required (not allowed on role="group"); a required choice says so in its label's mark and note.
  return <div role="group" id={control.id} aria-label={control.ariaLabel} aria-labelledby={control.labelledBy}
    aria-describedby={control.describedBy} aria-invalid={control.invalid || undefined} data-invalid={control.invalid || undefined}
    className={className}>
    {options.map(option => {
      const checked = value.includes(option.value)
      return <button key={option.value} type="button" role="checkbox" aria-checked={checked} title={option.title}
        disabled={control.disabled || option.disabled || undefined} className={cx(itemClassName, option.className)}
        {...option.data} onClick={() => toggle(option.value)}>{option.label}</button>
    })}
  </div>
}
