/** Small helpers shared by the `ui/` components: class joining, focus trapping, floating positioning and outside dismissal. */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ')

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
/** Focusable descendants in document order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('*')].filter(element => element.matches(FOCUSABLE))
}
/** Keeps Tab and Shift+Tab inside `root`. */
export function trapTab(event: KeyboardEvent, root: HTMLElement) {
  const items = focusables(root)
  const first = items[0], last = items.at(-1), active = document.activeElement
  const target = event.shiftKey ? last : first
  if (!target || !root.contains(active) || active === root || active === (event.shiftKey ? first : last)) {
    event.preventDefault()
    target?.focus()
  }
}

/** Keeps the latest value of a callback without re-running effects that read it. */
export function useLatest<V>(value: V) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

/** Marks the element focus falls back to when the element it should return to is gone (the page's main region). */
export const FOCUS_FALLBACK = 'data-focus-fallback'

/**
 * Where focus goes back to when a layer closes: the element that opened it while it is still in the document and focusable,
 * else the nearest `[data-focus-fallback]` region (the page's main region), so focus never drops to `<body>`.
 */
export function returnFocus(opener: HTMLElement | undefined) {
  const usable = (element: HTMLElement | null | undefined): element is HTMLElement => !!element && element.isConnected
    && !element.matches(':disabled') && !element.closest('[hidden], [inert]')
  if (usable(opener) && opener !== document.body) { opener.focus(); return opener }
  const fallback = document.querySelector<HTMLElement>(`[${FOCUS_FALLBACK}]`)
  if (usable(fallback)) { fallback.focus({ preventScroll: true }); return fallback }
  return undefined
}

/** The last focus move in the document, so a layer whose content took focus on mount still knows where focus came from. */
const lastMove: { from?: HTMLElement; to?: HTMLElement } = {}
let tracking = false
function trackFocus() {
  if (tracking || typeof document === 'undefined') return
  tracking = true
  document.addEventListener('focusin', event => {
    lastMove.to = event.target instanceof HTMLElement ? event.target : undefined
    lastMove.from = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : undefined
  }, true)
}
trackFocus()

/**
 * Modal-like surface behavior: focuses the surface on open, traps Tab, closes on Escape,
 * and returns focus to the element that opened it (or to the page's fallback region when that element is gone).
 */
export function useDialogFocus(open: boolean, surface: RefObject<HTMLElement | null>, onClose: () => void, initial?: RefObject<HTMLElement | null>) {
  const close = useLatest(onClose)
  useEffect(() => {
    if (!open) return
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    // A field inside that took focus on mount (autoFocus) already moved it: the opener is what had focus just before.
    const opener = active && surface.current?.contains(active) && lastMove.to === active ? lastMove.from : active
    // A field inside that already took focus on mount (autoFocus) keeps it; otherwise the initial target, else the surface itself.
    if (initial?.current) initial.current.focus()
    else if (!surface.current?.contains(document.activeElement)) surface.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); close.current() }
      else if (event.key === 'Tab' && surface.current) trapTab(event, surface.current)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // Return focus only when it is still inside the closing surface (or lost); a layer closed by a click elsewhere keeps that focus.
      const active = document.activeElement
      if (!active || active === document.body || surface.current?.contains(active) || !active.isConnected) returnFocus(opener)
    }
  }, [open, surface, initial, close])
}

/** Calls `onOutside` on a pointer down outside every given element. */
export function useOutside(open: boolean, refs: RefObject<HTMLElement | null>[], onOutside: () => void) {
  const handler = useLatest(onOutside)
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent | MouseEvent) => {
      const target = event.target as Node
      if (refs.every(ref => !ref.current?.contains(target))) handler.current()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, handler])
}

export type Placement = 'bottom-start' | 'bottom-end' | 'bottom' | 'top' | 'top-start' | 'right' | 'left'
/** Positions a fixed floating element next to its anchor, flipping vertically and clamping to the viewport. */
export function place(anchor: DOMRect, floating: { width: number; height: number }, placement: Placement, gap = 6, margin = 8) {
  const vw = window.innerWidth, vh = window.innerHeight
  let top: number, left: number
  if (placement === 'right' || placement === 'left') {
    top = anchor.top + anchor.height / 2 - floating.height / 2
    left = placement === 'right' ? anchor.right + gap : anchor.left - gap - floating.width
    if (placement === 'right' && left + floating.width > vw - margin) left = anchor.left - gap - floating.width
    if (placement === 'left' && left < margin) left = anchor.right + gap
  } else {
    const wantsTop = placement.startsWith('top')
    const below = anchor.bottom + gap, above = anchor.top - gap - floating.height
    const fitsBelow = below + floating.height <= vh - margin, fitsAbove = above >= margin
    top = wantsTop ? (fitsAbove || !fitsBelow ? above : below) : (fitsBelow || !fitsAbove ? below : above)
    left = placement.endsWith('start') ? anchor.left : placement.endsWith('end') ? anchor.right - floating.width
      : anchor.left + anchor.width / 2 - floating.width / 2
  }
  left = Math.max(margin, Math.min(left, vw - margin - floating.width))
  top = Math.max(margin, Math.min(top, vh - margin - floating.height))
  return { top, left }
}
/** Keeps a portaled floating element positioned against its anchor while open (scroll and resize included). */
export function useFloating(open: boolean, anchor: RefObject<HTMLElement | null>, floating: RefObject<HTMLElement | null>,
  placement: Placement, matchWidth = false) {
  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const a = anchor.current, f = floating.current
      if (!a || !f) return
      if (matchWidth) f.style.minWidth = `${a.getBoundingClientRect().width}px`
      const rect = f.getBoundingClientRect()
      const { top, left } = place(a.getBoundingClientRect(), rect, placement)
      f.style.top = `${top}px`; f.style.left = `${left}px`; f.style.visibility = 'visible'
    }
    update()
    window.addEventListener('scroll', update, true); window.addEventListener('resize', update)
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update) }
  }, [open, anchor, floating, placement, matchWidth])
}

/**
 * Moves an index through `count` items for the arrow keys of `orientation` (vertical: ↑/↓, horizontal: ←/→, both) and Home/End,
 * wrapping and skipping disabled ones; returns undefined for any other key.
 */
export function stepIndex(key: string, index: number, count: number, disabled: (index: number) => boolean = () => false,
  orientation: 'vertical' | 'horizontal' | 'both' = 'vertical'): number | undefined {
  if (count === 0) return undefined
  const vertical = orientation !== 'horizontal', horizontal = orientation !== 'vertical'
  const dir = (vertical && key === 'ArrowDown') || (horizontal && key === 'ArrowRight') ? 1
    : (vertical && key === 'ArrowUp') || (horizontal && key === 'ArrowLeft') ? -1 : 0
  let next = key === 'Home' ? 0 : key === 'End' ? count - 1 : dir === 0 ? undefined : index + dir
  if (next === undefined) return undefined
  const forward = key === 'Home' || dir > 0
  for (let tries = 0; tries < count; tries++) {
    next = (next + count) % count
    if (!disabled(next)) return next
    next += forward ? 1 : -1
  }
  return undefined
}
