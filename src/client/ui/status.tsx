/** Status marks: a dot per state (done, warning, error, idle) and a spinner for work in progress, with an optional spoken label. */
import { cx } from './util.ts'

export type DotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle'

/** The bare mark, hidden from assistive tech; pair it with text, or use `Dot` with a `label`. */
export function StateDot({ state, className }: { state: DotState; className?: string }) {
  if (state === 'ongoing') {
    return <svg className={cx('hx-dot-spinner', className)} data-state="ongoing" width={14} height={14} viewBox="0 0 24 24" aria-hidden="true">
      <g><circle cx="12" cy="12" r="9.5" /><circle cx="12" cy="12" r="9.5" /></g>
    </svg>
  }
  return <span className={cx('hx-state-dot', className)} data-state={state} aria-hidden="true" />
}

/** A state mark on a row; with `label` it is an image named by that label (and shows it on hover). */
export function Dot({ state, label }: { state: DotState; label?: string }) {
  const dot = <StateDot className="hx-dot" state={state} />
  return label ? <span className="hx-dot-wrap" title={label} role="img" aria-label={label}>{dot}</span> : dot
}
