/**
 * Keyboard-only driving for panel tests. jsdom dispatches key events but has no default actions, so this does what a browser does
 * after a key reaches the page unhandled: Tab moves focus through the tab order, Enter activates a button or link, Space activates a
 * button (and toggles a checkbox), and typing goes into the focused text field. A key a component handles (preventDefault) does only
 * what the component does. Nothing here clicks or focuses an element directly: a test that uses only `press`, `typeText` and
 * `tabTo` proves the step can be done from the keyboard alone.
 */
import { act } from 'react'
import { settle } from './panel.tsx'

const TABBABLE = 'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]'

/** Whether a person can see and reach `element`: not disabled, hidden, inert, or inside an aria-hidden or closed subtree. */
function reachable(element: HTMLElement) {
  if (element.matches(':disabled') || element.closest('[hidden], [inert], [aria-hidden="true"], fieldset:disabled')) return false
  if (element instanceof HTMLInputElement && element.type === 'hidden') return false
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

/** The page's tab order (DOM order; the panel uses no positive tabindex), limited to the open modal layer when there is one. */
export function tabOrder(): HTMLElement[] {
  const modal = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].at(-1)
  const root: ParentNode = modal ?? document
  const items = [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(element => element.tabIndex >= 0 && reachable(element))
  // A radio group without a checked radio is one stop at its first radio; with one, only the checked radio is a stop.
  return items.filter(element => !(element instanceof HTMLInputElement && element.type === 'radio' && !element.checked
    && items.some(other => other !== element && other instanceof HTMLInputElement && other.type === 'radio' && other.name === element.name)))
}

export const focused = () => document.activeElement as HTMLElement | null

/** Presses `key` on the focused element and performs the browser's default action when no component prevented it. */
export async function press(key: string, init: KeyboardEventInit = {}) {
  const target = focused() ?? document.body
  let handled = false
  await act(async () => {
    const down = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    handled = !target.dispatchEvent(down)
  })
  if (!handled) await act(async () => { defaultAction(target, key, init) })
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true, ...init })) })
  await frame()
  await settle()
}

function defaultAction(target: HTMLElement, key: string, init: KeyboardEventInit) {
  if (key === 'Tab') {
    const order = tabOrder()
    if (!order.length) return
    const index = order.indexOf(target)
    const next = index < 0 ? (init.shiftKey ? order.at(-1) : order[0]) : order[(index + (init.shiftKey ? -1 : 1) + order.length) % order.length]
    next?.focus()
    return
  }
  const isButton = target instanceof HTMLButtonElement || target.matches('[role="button"], [role="tab"], [role="radio"], [role="switch"], [role="menuitem"], [role="option"]')
  if (key === 'Enter' && (isButton || target instanceof HTMLAnchorElement)) target.click()
  else if (key === 'Enter' && target instanceof HTMLInputElement && target.form) target.form.requestSubmit()
  else if (key === ' ' && (isButton || (target instanceof HTMLInputElement && ['checkbox', 'radio'].includes(target.type)))) target.click()
}

/** Types `text` into the focused field the way a keyboard does: one input event with the new value. */
export async function typeText(text: string) {
  const input = focused()
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) throw new Error(`Focus is on ${describe(input)}, not a text field`)
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, input.value + text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}

/** Presses Tab (or Shift+Tab) until focus is on an element that matches `found`; fails after a full cycle of the tab order. */
export async function tabTo(found: (element: HTMLElement) => boolean, { back = false, what = 'the target' } = {}) {
  const limit = tabOrder().length + 2
  for (let step = 0; step < limit; step++) {
    const current = focused()
    if (current && current !== document.body && found(current)) return current
    await press('Tab', { shiftKey: back })
  }
  throw new Error(`Tab never reached ${what}; focus ended on ${describe(focused())}`)
}

/** A short readable name for an element in failure messages. */
export function describe(element: Element | null | undefined) {
  if (!element) return 'nothing'
  const name = element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 40) ?? ''
  return `<${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.getAttribute('role') ? ` role=${element.getAttribute('role')}` : ''}> "${name}"`
}

export const named = (name: string) => (element: HTMLElement) =>
  element.textContent?.trim() === name || element.getAttribute('aria-label') === name

/** Past one animation frame, for components that move focus after the next render. */
const frame = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
