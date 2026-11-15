/**
 * A small help or warning icon that explains something in a tooltip: on hover, on keyboard focus (focus-visible only), and on a tap on
 * touch screens. Escape hides it; the text is also the button's accessible name, so a screen reader reads it without the bubble.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './icon.tsx'
import { place } from './util.ts'

export function InfoTip({ text, icon = 'question', warn }: { text: string; icon?: IconName; warn?: boolean }) {
  const anchor = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    const target = anchor.current, element = bubble.current
    if (!open || !target || !element) return
    const { top, left } = place(target.getBoundingClientRect(), element.getBoundingClientRect(), 'top', 8, 12)
    element.style.left = `${left}px`; element.style.top = `${top}px`; element.style.visibility = 'visible'
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true); window.addEventListener('resize', close)
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [open])
  return <>
    <button ref={anchor} type="button" className="hx-info" data-warn={warn || undefined} aria-label={text}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onBlur={() => setOpen(false)}
      onFocus={event => { if (event.currentTarget.matches(':focus-visible')) setOpen(true) }}
      onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}
      onPointerUp={event => { if (event.pointerType === 'touch') setOpen(!open) }}
      onClick={event => { if (event.detail > 0 && (event.nativeEvent as PointerEvent).pointerType !== 'touch') setOpen(false) }}>
      <Icon name={icon} size={14} />
    </button>
    {open && createPortal(<span ref={bubble} role="tooltip" className="hx-tooltip hx-infotip" style={{ visibility: 'hidden' }}>{text}</span>,
      document.body)}
  </>
}
