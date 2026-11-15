/**
 * Form atoms and the text controls built from them.
 *
 * A field is a `FormField` context (ids, required, disabled, read-only, invalid) with atoms inside it: `Label`, `FieldHint`,
 * `FieldError` and, inside an Input, `Adornment`. Every control of the library reads the context through `useFieldControl`, so the
 * label, the note, the error and the control are wired the same way everywhere: `htmlFor` (or `aria-labelledby` for a control that
 * is not a labelable element), `aria-describedby` naming exactly the atoms that are rendered, `aria-invalid`, `aria-required`,
 * `disabled` and `readOnly`. `Field` is the usual layout of those atoms; `ControlGroup` is a field whose content is several controls
 * (a role="group" named by its label), and a static value under a label.
 */
import { createContext, forwardRef, isValidElement, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState,
  type HTMLAttributes, type InputHTMLAttributes, type ReactElement, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { InfoTip } from './infotip.tsx'
import { cx } from './util.ts'

type Part = 'hint' | 'error' | 'labelledby'
interface FieldState {
  /** The control's id, which the label's `htmlFor` names. */
  id: string; labelId: string; hintId: string; errorId: string
  /** The label as text, when it is a string: a control whose own `label` says the same leaves its name to the label element. */
  labelText: string | undefined
  /** A group field names its root (role="group"); the controls inside keep their own names and ids. */
  group: boolean
  required: boolean; disabled: boolean; readOnly: boolean; invalid: boolean
  hint: boolean; error: boolean; labelledBy: boolean
  register: (part: Part) => () => void
}
const FieldContext = createContext<FieldState | undefined>(undefined)

/** The field the caller sits in, or `undefined` outside one (for a custom control or atom). */
export function useFormField(): FieldState | undefined { return useContext(FieldContext) }

export interface FormFieldProps {
  /** The control's id; one is made up when absent. */
  id?: string | undefined
  label?: string | undefined
  required?: boolean | undefined; disabled?: boolean | undefined; readOnly?: boolean | undefined; invalid?: boolean | undefined
  group?: boolean | undefined
  children: ReactNode
}
/** The context the atoms and the control of one field share. It renders nothing of its own. */
export function FormField({ id, label, required, disabled, readOnly, invalid, group, children }: FormFieldProps) {
  const auto = useId()
  const base = id ?? auto
  const [parts, setParts] = useState<Record<Part, number>>({ hint: 0, error: 0, labelledby: 0 })
  const register = useCallback((part: Part) => {
    setParts(current => ({ ...current, [part]: current[part] + 1 }))
    return () => setParts(current => ({ ...current, [part]: current[part] - 1 }))
  }, [])
  const value = useMemo<FieldState>(() => ({ id: base, labelId: `${base}-label`, hintId: `${base}-hint`, errorId: `${base}-error`,
    labelText: label, group: !!group, required: !!required, disabled: !!disabled, readOnly: !!readOnly,
    invalid: !!invalid || parts.error > 0, hint: parts.hint > 0, error: parts.error > 0, labelledBy: parts.labelledby > 0, register }),
  [base, label, group, required, disabled, readOnly, invalid, parts, register])
  return <FieldContext.Provider value={value}>{children}</FieldContext.Provider>
}

const join = (...ids: (string | false | undefined | null)[]) => ids.filter(Boolean).join(' ') || undefined
/** The ids of the rendered note and error, for the element that describes the field (the control, or a group's root). */
const describedOf = (field: FieldState) => join(field.error && field.errorId, field.hint && field.hintId)

export interface FieldControlInput {
  id?: string | undefined; label?: string | undefined; describedBy?: string | undefined
  invalid?: boolean | undefined; required?: boolean | undefined; disabled?: boolean | undefined; readOnly?: boolean | undefined
}
export interface FieldControl {
  id: string | undefined
  /** Set only when the control must name itself: outside a field, or when its own label says something the field's label does not. */
  ariaLabel: string | undefined
  labelledBy: string | undefined
  describedBy: string | undefined
  invalid: boolean; required: boolean; disabled: boolean; readOnly: boolean
}
/**
 * How a control wires itself into the field around it. A labelable element (input, textarea, button) is named by the label's
 * `htmlFor`; pass `labelable: false` for a composite (a radio group, an editor) and it gets `aria-labelledby` instead, the label then
 * rendering as a plain span. Outside a field, or in a group field, the control keeps what it was given.
 */
export function useFieldControl(own: FieldControlInput, { labelable = true }: { labelable?: boolean } = {}): FieldControl {
  const field = useContext(FieldContext)
  const active = !!field && !field.group
  const register = field?.register
  useLayoutEffect(() => { if (active && !labelable && register) return register('labelledby') }, [active, labelable, register])
  if (!active) return { id: own.id, ariaLabel: own.label, labelledBy: undefined, describedBy: own.describedBy, invalid: !!own.invalid,
    required: !!own.required, disabled: !!own.disabled, readOnly: !!own.readOnly }
  const named = own.label === undefined || own.label === field.labelText
  return {
    id: field.id,
    ariaLabel: named ? undefined : own.label,
    labelledBy: labelable || !named ? undefined : field.labelId,
    describedBy: join(own.describedBy, describedOf(field)),
    invalid: own.invalid ?? field.invalid,
    required: own.required ?? field.required,
    disabled: !!own.disabled || field.disabled,
    readOnly: !!own.readOnly || field.readOnly,
  }
}

/** The field's label: a `<label>` for its control, or a span its control or group names with `aria-labelledby`. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  const field = useContext(FieldContext)
  const mark = field?.required && <span className="hx-field-req" aria-hidden="true">*</span>
  if (field && (field.group || field.labelledBy)) return <span id={field.labelId} className={cx('hx-field-label', className)}>{children}{mark}</span>
  return <label id={field?.labelId} htmlFor={field?.id} className={cx('hx-field-label', className)}>{children}{mark}</label>
}

function usePart(part: 'hint' | 'error') {
  const field = useContext(FieldContext)
  const register = field?.register
  useLayoutEffect(() => register?.(part), [register, part])
  return field
}
/** The note under a control; the field's control (or group) is described by it while it is rendered. */
export function FieldHint({ children, className }: { children: ReactNode; className?: string }) {
  const field = usePart('hint')
  return <small id={field?.hintId} className={cx('hx-field-hint', className)}>{children}</small>
}
/** The field's error: announced (role="alert"), it describes the control and marks the field invalid while it is rendered. */
export function FieldError({ children, className }: { children: ReactNode; className?: string }) {
  const field = usePart('error')
  return <p id={field?.errorId} className={cx('hx-field-error', className)} role="alert">{children}</p>
}
/** Something drawn inside an Input before or after the text (an icon, a unit). */
export function Adornment({ children }: { children: ReactNode }) {
  return <span className="hx-input-adorn">{children}</span>
}

export type FieldProps = {
  label: ReactNode
  /** The control's id, when the page needs to know it; otherwise the field makes one (or takes the single child's `id`). */
  htmlFor?: string | undefined
  hint?: ReactNode; info?: string | undefined; error?: ReactNode
  required?: boolean | undefined; disabled?: boolean | undefined; readOnly?: boolean | undefined; invalid?: boolean | undefined
  inline?: boolean | undefined
  /** Content drawn beside the label in the head (a badge, a count, a button). */
  aside?: ReactNode
  /** Several controls, or a static value, under one label: the root is a role="group" named by the label. */
  group?: boolean | undefined
  className?: string | undefined
  children: ReactNode
} & Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'>

/**
 * Label, control, note and error laid out as one field. `info` adds a help tip beside the label; `hint` is the note under the
 * control, replaced by `error` while there is one.
 */
export function Field({ label, htmlFor, hint, info, error, required, disabled, readOnly, invalid, inline, aside, group, className, children,
  ...rest }: FieldProps) {
  const single = htmlFor === undefined && isValidElement<{ id?: string }>(children) ? (children as ReactElement<{ id?: string }>).props.id : undefined
  return <FormField id={htmlFor ?? single} label={typeof label === 'string' ? label : undefined} required={required} disabled={disabled}
    readOnly={readOnly} invalid={invalid || !!error} group={group}>
    <FieldRoot className={className} inline={inline} {...rest}>
      <FieldHead><Label>{label}</Label>{info && <InfoTip text={info} />}{aside}</FieldHead>
      <div className="hx-field-control">{children}</div>
      {error ? <FieldError>{error}</FieldError> : hint ? <FieldHint>{hint}</FieldHint> : null}
    </FieldRoot>
  </FormField>
}
/**
 * A field's root element, for a page that lays the atoms out itself. In a group field the root is the group, named by the label and
 * described by the note or error.
 */
export function FieldRoot({ className, inline, children, ...rest }: { className?: string | undefined; inline?: boolean | undefined
  children: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'>) {
  const field = useContext(FieldContext)
  return <div className={cx('hx-field', className)} data-inline={inline || undefined}
    {...field?.group ? { role: 'group', 'aria-labelledby': field.labelId, 'aria-describedby': describedOf(field) } : {}} {...rest}>
    {children}
  </div>
}
/** The line above a control: the label, then what sits beside it (a help tip, a badge, a count). */
export function FieldHead({ children }: { children: ReactNode }) { return <span className="hx-field-head">{children}</span> }
/** A field holding several controls (or a value to read) under one label, as a named group. */
export function ControlGroup(props: Omit<FieldProps, 'group' | 'htmlFor'>) { return <Field {...props} group /> }

export type InputProps = { start?: ReactNode; end?: ReactNode; invalid?: boolean; size?: 'sm' | 'md'; wrapperClassName?: string }
  & Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ start, end, invalid, size = 'md', wrapperClassName,
  className, id, 'aria-label': label, 'aria-describedby': describedBy, required, disabled, readOnly, ...rest }, ref) {
  const control = useFieldControl({ id, label, describedBy, invalid, required, disabled, readOnly })
  return <span className={cx('hx-input', wrapperClassName)} data-size={size} data-invalid={control.invalid || undefined}
    data-disabled={control.disabled || undefined}>
    {start !== undefined && <Adornment>{start}</Adornment>}
    <input ref={ref} className={className} id={control.id} aria-label={control.ariaLabel} aria-describedby={control.describedBy}
      aria-invalid={control.invalid || undefined} required={control.required || undefined} disabled={control.disabled || undefined}
      readOnly={control.readOnly || undefined} {...rest} />
    {end !== undefined && <Adornment>{end}</Adornment>}
  </span>
})

export type TextareaProps = { invalid?: boolean; autoGrow?: boolean; maxRows?: number } & TextareaHTMLAttributes<HTMLTextAreaElement>
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ invalid, autoGrow = true, maxRows = 16, className,
  value, onChange, id, 'aria-label': label, 'aria-describedby': describedBy, required, disabled, readOnly, ...rest }, forwarded) {
  const control = useFieldControl({ id, label, describedBy, invalid, required, disabled, readOnly })
  const inner = useRef<HTMLTextAreaElement | null>(null)
  const ref = useCallback((element: HTMLTextAreaElement | null) => {
    inner.current = element
    if (typeof forwarded === 'function') forwarded(element)
    else if (forwarded) forwarded.current = element
  }, [forwarded])
  useLayoutEffect(() => {
    const element = inner.current
    if (!autoGrow || !element) return
    const line = parseFloat(getComputedStyle(element).lineHeight) || 20
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, line * maxRows + 22)}px`
  }, [value, autoGrow, maxRows])
  return <textarea ref={ref} className={cx('hx-textarea', className)} id={control.id} aria-label={control.ariaLabel}
    aria-describedby={control.describedBy} data-invalid={control.invalid || undefined} aria-invalid={control.invalid || undefined}
    required={control.required || undefined} disabled={control.disabled || undefined} readOnly={control.readOnly || undefined}
    value={value} onChange={onChange} {...rest} />
})
