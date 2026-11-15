/** A row that shows or hides the content under it; Enter and Space toggle it, and its icon turns into a chevron on hover or when open. */
import { type ReactNode } from 'react'
import { Icon } from './icon.tsx'

export function DisclosureRow({ icon, title, open, onToggle, collapsedContent, children }: {
  icon: ReactNode; title: ReactNode; open: boolean; onToggle: () => void; collapsedContent?: ReactNode; children?: ReactNode
}) {
  return <div className="hx-disclosure" data-open={open || undefined}>
    <div className="hx-disclosure-row" role="button" tabIndex={0} aria-expanded={open} data-disclosure-row onClick={onToggle}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle() } }}>
      <span className="hx-disclosure-lead">
        <span className="hx-disclosure-icon">{icon}</span>
        <span className="hx-disclosure-chevron"><Icon name={open ? 'chevron-up' : 'chevron-down'} /></span>
      </span>
      <span className="hx-disclosure-title">{title}</span>
      {!open && collapsedContent}
    </div>
    {open && children}
  </div>
}
