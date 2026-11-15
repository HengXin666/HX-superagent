/** Buttons: text buttons with variants, sizes and a busy state, and icon-only buttons that always carry an accessible label. */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Icon, type IconName } from './icon.tsx'
import { cx } from './util.ts'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'
export type ButtonProps = {
  variant?: ButtonVariant; size?: ButtonSize; icon?: IconName | ReactNode; iconEnd?: IconName | ReactNode
  /** Shows a spinner, keeps the width and blocks clicks; the button stays focusable so focus is never lost while saving. */
  busy?: boolean
} & ButtonHTMLAttributes<HTMLButtonElement>

const glyph = (icon: IconName | ReactNode, size: number) => typeof icon === 'string' ? <Icon name={icon as IconName} size={size} /> : icon

export function Spinner({ size = 14 }: { size?: number }) {
  return <svg className="hx-spinner" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" strokeWidth="2.4" /></svg>
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', icon, iconEnd, busy,
  className, children, type = 'button', onClick, disabled, ...rest }, ref) {
  const px = size === 'sm' ? 14 : 16
  return <button ref={ref} type={type} className={cx('hx-btn', className)} data-variant={variant} data-size={size} data-busy={busy || undefined}
    aria-busy={busy || undefined} aria-disabled={busy || undefined} disabled={disabled}
    onClick={event => { if (busy) { event.preventDefault(); return } onClick?.(event) }} {...rest}>
    {busy ? <Spinner size={px} /> : icon !== undefined && glyph(icon, px)}
    {children !== undefined && <span className="hx-btn-label">{children}</span>}
    {iconEnd !== undefined && glyph(iconEnd, px)}
  </button>
})

export type IconButtonProps = {
  icon: IconName | ReactNode
  /** Required: read by screen readers and shown as the native tooltip. */
  label: string
  variant?: 'ghost' | 'secondary' | 'danger'; size?: ButtonSize; busy?: boolean; pressed?: boolean
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ icon, label, variant = 'ghost', size = 'md', busy,
  pressed, className, type = 'button', title, onClick, ...rest }, ref) {
  return <button ref={ref} type={type} className={cx('hx-icon-btn', className)} data-variant={variant} data-size={size} aria-label={label}
    title={title ?? label} aria-pressed={pressed} aria-busy={busy || undefined}
    onClick={event => { if (busy) { event.preventDefault(); return } onClick?.(event) }} {...rest}>
    {busy ? <Spinner size={size === 'sm' ? 14 : 16} /> : glyph(icon, size === 'sm' ? 14 : 16)}
  </button>
})
