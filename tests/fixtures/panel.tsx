/** DOM rendering and interaction helpers for panel tests. */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { expect, vi } from 'vitest'
import { App } from '../../src/client/app.tsx'
import { usePageForm } from '../../src/client/deployment.tsx'
import { zh } from '../../src/client/locales.ts'
import type { T } from '../../src/client/text.ts'
import { server, usePanelServer } from './panel-server.ts'

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

export const translator = (dictionary: Record<string, string>): T => ((key: string, params?: Record<string, unknown>) => {
  const template = dictionary[key] ?? key
  return params ? template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match) : template
}) as T
function Panel({ t }: { t: T }) {
  return <App t={t} openSession={async id => { server.opened.push(id) }} deploymentForm={usePageForm(server.form)} />
}
let root: Root | undefined
let container: HTMLElement | undefined
function unmount() {
  act(() => { root?.unmount() })
  root = undefined
  container?.remove()
}
export const usePanel = () => usePanelServer(unmount)

/** Flush pending fake-server responses and React state updates. */
export async function settle() {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(server.pending).toBe(0)
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
export async function mount(dictionary: Record<string, string> = zh) {
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  await act(async () => { root!.render(<Panel t={translator(dictionary)} />) })
  await settle()
}
export async function remount(dictionary: Record<string, string> = zh) { unmount(); await mount(dictionary) }

export const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)]
const CONTROLS = 'button, [role="button"], [role="tab"], [role="switch"], a'
/** A control's names: its text, its aria-label, and the label elements or ids that name it (how the form atoms wire a field). */
function names(element: HTMLElement): string[] {
  const labelled = element.getAttribute('aria-labelledby')?.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim() ?? '') ?? []
  const labels = 'labels' in element ? [...(element as HTMLInputElement).labels ?? []].map(label => label.textContent?.replace(/\*$/, '').trim() ?? '') : []
  return [element.textContent?.trim() ?? '', element.getAttribute('aria-label') ?? '', labelled.join(' '), ...labels]
}
export function find(name: string, selector = CONTROLS): HTMLElement {
  const match = all(selector).find(element => names(element).includes(name))
  if (!match) throw new Error(`No ${selector} named ${name}`)
  return match
}
export const tab = (name: string) => find(name, '[role="tab"]')
export async function click(target: string | HTMLElement) {
  const element = typeof target === 'string' ? find(target) : target
  await act(async () => { element.click() })
  await settle()
}
/** The labels a panel Select offers, read by opening it and closing it again. */
export async function choices(select: Element, read: 'label' | 'value' = 'label'): Promise<string[]> {
  await act(async () => { (select as HTMLElement).click() })
  const labels = [...document.querySelectorAll('[role="option"]')].map(option => read === 'value' ? option.getAttribute('data-value') ?? ''
    : option.querySelector('.hx-option-label')?.textContent ?? '')
  await act(async () => { (select as HTMLElement).click() })
  return labels
}
export async function type(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | Element, value: string) {
  // A panel Select is a button that opens a list: pick the option with that value.
  if (element instanceof HTMLButtonElement && element.getAttribute('role') === 'combobox') {
    await act(async () => { element.click() })
    const option = document.querySelector<HTMLElement>(`[role="option"][data-value=${JSON.stringify(value)}]`)
    if (!option) throw new Error(`No option ${value}`)
    await act(async () => { option.click() })
    await settle()
    return
  }
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) throw new Error('Not a field')
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
  await settle()
}
/** Presses a key on an element, as a person at the keyboard does (Enter commits a Combobox's typed value). */
export async function press(element: Element, key: string) {
  await act(async () => { element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
  await settle()
}
/** Types into a Combobox and commits the text with Enter: an option it names, or the text itself where the field takes its own. */
export async function enter(element: Element, value: string) {
  await type(element, value)
  await press(element, 'Enter')
}
/** The page's text without its stylesheet. */
export const text = () => [...document.body.querySelectorAll('style')].reduce((all, style) => all.replace(style.textContent ?? '', ''),
  document.body.textContent ?? '')
export function field<E extends HTMLElement>(label: string): E {
  const labelled = (element: HTMLElement) => !!element.id && all('label').some(item => (item as HTMLLabelElement).htmlFor === element.id
    && item.textContent === label)
  const match = all('input, textarea, select, button[role="combobox"]').find(element => element.getAttribute('aria-label') === label || labelled(element))
  if (!match) throw new Error(`No field ${label}`)
  return match as unknown as E
}
export const at = (route: object) => sessionStorage.setItem('dsh-superagent/route', JSON.stringify({ route, stack: [] }))
